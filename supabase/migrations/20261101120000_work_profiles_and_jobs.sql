-- Work (ADR 0018): professional profiles, job posts and the built-in Work lens.
--
-- 1. profiles.professional holds the work side of a profile as a JSON Resume subset (headline,
--    summary, work, education, skills, languages, links, open to work or hiring). It is public like
--    the rest of a profile and is written only through open_media_set_professional_profile, which
--    checks its shape. The app and the Worker check the same rules (src/domain/professionalProfile.ts).
-- 2. Jobs are listings (kind 'job'): the price is the bottom of the pay range, and a job adds the
--    top of the range, the kind of employment and an optional https link to the employer's own
--    application page. Jobs can never be paid for, and Open Media never applies for anyone.
-- 3. "work" becomes a built-in lens id, so nobody can save a lens that takes it.

-- 1. Professional profiles ────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists professional jsonb not null default '{}'::jsonb;
alter table public.profiles drop constraint if exists profiles_professional_check;
alter table public.profiles add constraint profiles_professional_check
  check (jsonb_typeof(professional) = 'object' and pg_column_size(professional) <= 32768);

-- The shape the app writes; anything else is refused. Text lengths match professionalProfile.ts.
create or replace function app_private.valid_professional(p jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
    and not exists (select 1 from jsonb_object_keys(p) key where key not in ('headline', 'summary', 'openTo', 'location', 'work', 'education', 'skills', 'languages', 'links'))
    and (not p ? 'headline' or (jsonb_typeof(p -> 'headline') = 'string' and char_length(p ->> 'headline') <= 120))
    and (not p ? 'summary' or (jsonb_typeof(p -> 'summary') = 'string' and char_length(p ->> 'summary') <= 1200))
    and (not p ? 'location' or (jsonb_typeof(p -> 'location') = 'string' and char_length(p ->> 'location') <= 120))
    and (not p ? 'openTo' or p ->> 'openTo' in ('work', 'hiring'))
    and (not p ? 'work' or (jsonb_typeof(p -> 'work') = 'array' and jsonb_array_length(p -> 'work') <= 20
      and not exists (select 1 from jsonb_array_elements(p -> 'work') item where jsonb_typeof(item) <> 'object' or coalesce(item ->> 'name', '') = '' or coalesce(item ->> 'position', '') = '')))
    and (not p ? 'education' or (jsonb_typeof(p -> 'education') = 'array' and jsonb_array_length(p -> 'education') <= 10
      and not exists (select 1 from jsonb_array_elements(p -> 'education') item where jsonb_typeof(item) <> 'object' or coalesce(item ->> 'institution', '') = '')))
    and (not p ? 'skills' or (jsonb_typeof(p -> 'skills') = 'array' and jsonb_array_length(p -> 'skills') <= 50))
    and (not p ? 'languages' or (jsonb_typeof(p -> 'languages') = 'array' and jsonb_array_length(p -> 'languages') <= 10))
    and (not p ? 'links' or (jsonb_typeof(p -> 'links') = 'array' and jsonb_array_length(p -> 'links') <= 8
      and not exists (select 1 from jsonb_array_elements(p -> 'links') item where coalesce(item ->> 'url', '') !~ '^https://')));
$$;
revoke all on function app_private.valid_professional(jsonb) from public, anon, authenticated;

create or replace function public.open_media_set_professional_profile(p_professional jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_value jsonb := coalesce(p_professional, '{}'::jsonb);
begin
  if v_user is null then raise exception 'A valid Open Media session is required.' using errcode = '42501'; end if;
  if pg_column_size(v_value) > 32768 or not app_private.valid_professional(v_value) then
    raise exception 'Check the professional profile: headline up to 120 characters, up to 20 jobs, 10 schools, 50 skills and 8 https links.' using errcode = '22023';
  end if;
  update public.profiles set professional = v_value, updated_at = now() where id = v_user;
  if not found then raise exception 'Create your profile first.' using errcode = 'P0002'; end if;
  return v_value;
end;
$$;
revoke all on function public.open_media_set_professional_profile(jsonb) from public, anon;
grant execute on function public.open_media_set_professional_profile(jsonb) to authenticated;

-- Public profiles now carry the professional profile, for the same people who may see the bio.
create or replace function public.open_media_public_profile(p_handle text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is not null and app_private.users_are_blocked(auth.uid(), profile.id) then null
    when app_private.can_view_profile(auth.uid(), profile.id) then app_private.profile_card(profile) || jsonb_build_object(
      'bio', profile.bio,
      'joinedAt', profile.created_at,
      'linkedAccounts', profile.linked_accounts,
      'professional', profile.professional,
      'postCount', (select count(*) from public.posts post where post.author_id = profile.id and post.removed_at is null),
      'canView', true,
      'followStatus', app_private.follow_status(auth.uid(), profile.id)
    )
    else app_private.profile_card(profile) || jsonb_build_object('canView', false, 'followStatus', app_private.follow_status(auth.uid(), profile.id))
  end
  from public.profiles profile
  where profile.handle = lower(p_handle);
$$;

-- 2. Jobs ─────────────────────────────────────────────────────────────────────────

alter table public.post_listings
  add column if not exists pay_max_minor bigint,
  add column if not exists employment_type text,
  add column if not exists apply_url text;
alter table public.post_listings drop constraint if exists post_listings_kind_check;
alter table public.post_listings add constraint post_listings_kind_check check (kind in ('product', 'service', 'event', 'job'));
-- Yearly pay can be far above any sale price, so jobs get their own ceiling.
alter table public.post_listings drop constraint if exists post_listings_price_minor_check;
alter table public.post_listings add constraint post_listings_price_minor_check
  check (price_minor is null or price_minor between 0 and case when kind = 'job' then 100000000000 else 100000000 end);
alter table public.post_listings drop constraint if exists post_listings_job_check;
alter table public.post_listings add constraint post_listings_job_check check (
  case when kind = 'job' then
    employment_type in ('full_time', 'part_time', 'contract', 'internship', 'freelance')
    and (pay_max_minor is null or (price_minor is not null and pay_max_minor between price_minor and 100000000000))
    and (apply_url is null or (apply_url ~ '^https://[^\s/@]+(/[^\s]*)?$' and char_length(apply_url) <= 500))
  else pay_max_minor is null and employment_type is null and apply_url is null end
);

create or replace function app_private.listing_json(p_post_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'kind', l.kind, 'title', l.title, 'priceMinor', l.price_minor, 'currency', l.currency,
    'location', l.location_text, 'remote', l.remote, 'availability', l.availability, 'groupId', l.listing_group_id,
    'rating', app_private.rating_summary(l.listing_group_id)
  )
  || case when l.kind = 'event' then jsonb_build_object(
       'startsAt', case when l.date_only then to_char(l.starts_at at time zone 'UTC', 'YYYY-MM-DD') else to_char(l.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
       'dateOnly', l.date_only, 'timezone', l.timezone) else '{}'::jsonb end
  || case when l.kind = 'job' then jsonb_build_object('job', jsonb_strip_nulls(jsonb_build_object(
       'employmentType', l.employment_type, 'payMaxMinor', l.pay_max_minor, 'applyUrl', l.apply_url))) else '{}'::jsonb end
  || case when l.author_id = auth.uid() and l.check_state in ('held', 'review') then jsonb_build_object('check', jsonb_strip_nulls(jsonb_build_object(
       'state', l.check_state,
       'reason', coalesce((select c.reasons -> 0 ->> 'message' from public.listing_checks c where c.post_id = l.post_id and c.state = l.check_state order by c.created_at desc limit 1), 'It needs a closer look.'),
       'fix', (select c.reasons -> 0 ->> 'fix' from public.listing_checks c where c.post_id = l.post_id and c.state = l.check_state order by c.created_at desc limit 1)
     ))) else '{}'::jsonb end
  || case when app_private.checked_by(l.post_id) > 0 then jsonb_build_object('checkedBy', app_private.checked_by(l.post_id)) else '{}'::jsonb end
  || case when l.via_agent then jsonb_build_object('viaAgent', true) else '{}'::jsonb end
  || coalesce((
       select jsonb_build_object('seller', jsonb_strip_nulls(jsonb_build_object('name', d.business_name, 'address', d.address, 'email', d.email, 'phone', d.phone)))
       from public.seller_disclosures d
       where d.user_id = l.author_id and d.confirmed_at is not null and d.business_name is not null
         and (select v.gross_usd from app_private.seller_volume(l.author_id) v) >= 20000
     ), '{}'::jsonb)
  from public.post_listings l where l.post_id = p_post_id;
$$;
revoke all on function app_private.listing_json(uuid) from public, anon;
grant execute on function app_private.listing_json(uuid) to authenticated;

create or replace function public.open_media_create_listing_post(p_client_id uuid, p_body text, p_listing jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := btrim(coalesce(p_listing ->> 'title', ''));
  v_kind text := coalesce(p_listing ->> 'kind', 'product');
  v_starts timestamptz;
  v_date_only boolean := coalesce((p_listing ->> 'dateOnly')::boolean, false);
  v_timezone text := nullif(btrim(coalesce(p_listing ->> 'timezone', '')), '');
  v_job jsonb := case when v_kind = 'job' then coalesce(p_listing -> 'job', '{}'::jsonb) else null end;
  v_post jsonb;
  v_post_id uuid;
begin
  if v_user_id is null then raise exception 'A valid Open Media session is required.' using errcode = '42501'; end if;
  if p_listing is null or jsonb_typeof(p_listing) <> 'object' then raise exception 'The listing details are missing.' using errcode = '22023'; end if;
  if (p_listing ->> 'priceMinor') is not null and (p_listing ->> 'priceMinor') !~ '^\d{1,12}$' then
    raise exception 'The price must be a whole number of cents.' using errcode = '22023';
  end if;
  if v_job is not null and ((v_job ->> 'payMaxMinor') is not null and (v_job ->> 'payMaxMinor') !~ '^\d{1,12}$') then
    raise exception 'The top of the pay range must be a whole number of cents.' using errcode = '22023';
  end if;
  if v_kind = 'event' then
    begin
      v_starts := case when v_date_only then ((p_listing ->> 'startsAt')::date)::timestamp at time zone 'UTC' else (p_listing ->> 'startsAt')::timestamptz end;
    exception when others then
      raise exception 'Say when the event starts.' using errcode = '22023';
    end;
    if v_starts is null or v_starts < now() - interval '1 day' or v_starts > now() + interval '3 years' then
      raise exception 'Choose an event time in the future.' using errcode = '22023';
    end if;
    if v_timezone is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then v_timezone := null; end if;
  end if;
  -- New accounts start with a few live listings, so a fresh account can't flood the Feed.
  if (select created_at from public.profiles where id = v_user_id) > now() - interval '7 days'
     and not app_private.is_verified(v_user_id)
     and (select count(*) from public.post_listings l join public.posts p on p.id = l.post_id
          where l.author_id = v_user_id and p.removed_at is null and l.check_state <> 'held') >= 3 then
    raise exception 'New accounts can have up to 3 listings in their first week.' using errcode = '54000';
  end if;
  -- The post text defaults to the title, so a listing never needs a separate caption.
  v_post := app_private.create_post(p_client_id, coalesce(nullif(btrim(coalesce(p_body, '')), ''), v_title), null);
  v_post_id := (v_post ->> 'id')::uuid;
  begin
    insert into public.post_listings (post_id, author_id, kind, title, price_minor, currency, location_text, remote, availability, starts_at, date_only, timezone, pay_max_minor, employment_type, apply_url)
    values (
      v_post_id, v_user_id, v_kind, v_title,
      (p_listing ->> 'priceMinor')::bigint,
      coalesce(upper(p_listing ->> 'currency'), 'USD'),
      nullif(btrim(coalesce(p_listing ->> 'location', '')), ''),
      coalesce((p_listing ->> 'remote')::boolean, false),
      coalesce(p_listing ->> 'availability', 'available'),
      v_starts, v_kind = 'event' and v_date_only, case when v_kind = 'event' then v_timezone end,
      (v_job ->> 'payMaxMinor')::bigint,
      case when v_kind = 'job' then coalesce(v_job ->> 'employmentType', 'full_time') end,
      nullif(btrim(coalesce(v_job ->> 'applyUrl', '')), '')
    )
    on conflict (post_id) do nothing;
  exception
    when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Check the listing: a product, service, event or job, a title up to 120 characters, a price or pay range, a 3-letter currency, and an https apply link.' using errcode = '22023';
  end;
  -- Posting a held listing again with the fix replaces the held one.
  update public.posts p set removed_at = now(), removal_reason = 'author'
  from public.post_listings l
  where l.post_id = p.id and l.author_id = v_user_id and l.check_state = 'held' and p.id <> v_post_id
    and lower(l.title) = lower(v_title) and p.created_at > now() - interval '7 days' and p.removed_at is null;
  return v_post || jsonb_build_object('listing', app_private.listing_json(v_post_id));
end;
$$;

create or replace function public.open_media_update_listing(p_post_id uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'A valid Open Media session is required.' using errcode = '42501'; end if;
  if (p_changes ->> 'priceMinor') is not null and (p_changes ->> 'priceMinor') !~ '^\d{1,12}$' then
    raise exception 'The price must be a whole number of cents.' using errcode = '22023';
  end if;
  begin
    update public.post_listings set
      price_minor = case when p_changes ? 'priceMinor' then (p_changes ->> 'priceMinor')::bigint else price_minor end,
      location_text = case when p_changes ? 'location' then nullif(btrim(coalesce(p_changes ->> 'location', '')), '') else location_text end,
      remote = coalesce((p_changes ->> 'remote')::boolean, remote),
      availability = coalesce(p_changes ->> 'availability', availability),
      check_state = case when p_changes ? 'priceMinor' or p_changes ? 'location' then 'pending' else check_state end,
      updated_at = now()
    where post_id = p_post_id and author_id = auth.uid();
  exception when check_violation then
    raise exception 'That price is out of range for this listing.' using errcode = '22023';
  end;
  if not found then raise exception 'Listing not found.' using errcode = 'P0002'; end if;
  return app_private.listing_json(p_post_id);
end;
$$;

-- The background check also looks at a job's apply link.
create or replace function public.open_media_pending_listing_checks(p_limit integer default 25)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by (item ->> 'updatedAt')), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'postId', l.post_id, 'authorId', l.author_id, 'kind', l.kind, 'title', l.title, 'body', p.body,
      'priceMinor', l.price_minor, 'currency', l.currency, 'location', l.location_text, 'applyUrl', l.apply_url,
      'authorAgeDays', floor(extract(epoch from now() - pr.created_at) / 86400)::integer,
      'authorVerified', app_private.is_verified(l.author_id),
      'viaAgent', l.via_agent, 'agentSigned', l.agent_signed,
      'linkedAccounts', coalesce(jsonb_array_length(pr.linked_accounts), 0),
      'updatedAt', l.updated_at
    ) as item
    from public.post_listings l
    join public.posts p on p.id = l.post_id and p.removed_at is null
    join public.profiles pr on pr.id = l.author_id
    where l.check_state = 'pending'
    order by l.updated_at
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
  ) pending;
$$;
revoke all on function public.open_media_pending_listing_checks(integer) from public, anon, authenticated;
grant execute on function public.open_media_pending_listing_checks(integer) to service_role;

-- A job is never paid for.
create or replace function app_private.enforce_marketplace_payment_rules()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.context_type = 'listing' and exists (select 1 from public.post_listings where post_id = new.context_id and check_state = 'held') then
    raise exception 'This listing is unavailable.' using errcode = 'P0002';
  end if;
  if new.context_type = 'listing' and exists (select 1 from public.post_listings where post_id = new.context_id and kind = 'job') then
    raise exception 'Jobs can’t be paid for. Apply on the employer’s page or message the poster.' using errcode = '42501';
  end if;
  if app_private.seller_paused(new.recipient_id) then
    raise exception 'This seller’s sales are paused until they confirm their details.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Open jobs, newest first, for find_jobs and GET /v1/jobs. Same visibility rules as the Feed.
create or replace function public.open_media_public_jobs(p_query text default null, p_remote boolean default null, p_limit integer default 30)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(item.post order by item.created_at desc, item.id desc), '[]'::jsonb)
  from (
    select app_private.public_post_json(post, profile) as post, post.created_at, post.id
    from public.posts post
    join public.post_listings listing on listing.post_id = post.id and listing.kind = 'job'
    join public.profiles profile on profile.id = post.author_id
    where post.removed_at is null
      and listing.availability <> 'sold_out'
      and (p_remote is null or listing.remote = p_remote)
      and (nullif(btrim(p_query), '') is null
        or listing.title ilike '%' || btrim(p_query) || '%' or post.body ilike '%' || btrim(p_query) || '%'
        or listing.location_text ilike '%' || btrim(p_query) || '%')
      and app_private.can_view_profile(auth.uid(), post.author_id)
      and not app_private.listing_hidden(post.id, auth.uid())
    order by post.created_at desc, post.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50)
  ) item;
$$;
revoke all on function public.open_media_public_jobs(text, boolean, integer) from public;
grant execute on function public.open_media_public_jobs(text, boolean, integer) to anon, authenticated;

-- 3. The Work lens ────────────────────────────────────────────────────────────────

-- Anyone who already saved a lens called "work" keeps it under a new id.
update public.feed_lenses set lens_key = 'work-' || left(replace(id::text, '-', ''), 8), updated_at = now() where lens_key = 'work';
alter table public.feed_lenses drop constraint if exists feed_lenses_lens_key_check;
alter table public.feed_lenses add constraint feed_lenses_lens_key_check
  check (lens_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$' and lens_key not in ('raw', 'relevant', 'work'));

comment on column public.profiles.professional is 'Work profile as a JSON Resume subset (ADR 0018). Public like the bio; written only through open_media_set_professional_profile.';
comment on column public.post_listings.apply_url is 'Jobs only: the employer''s own https application page. Open Media never applies for anyone (ADR 0018).';
