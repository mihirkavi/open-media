-- Products and services in the Feed (ADR 0013, phase 3). A listing is an ordinary public post
-- with typed details: what it is, the price in minor units, where, and whether it is still
-- available. Prices are integers, never strings, so ratings and payments can rely on them later.

create table if not exists public.post_listings (
  post_id uuid primary key references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('product', 'service')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  price_minor bigint check (price_minor is null or price_minor between 0 and 100000000),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  location_text text check (location_text is null or char_length(location_text) between 1 and 120),
  remote boolean not null default false,
  availability text not null default 'available' check (availability in ('available', 'limited', 'sold_out')),
  -- Copies of the same item share a group so ratings count once (phase 4).
  listing_group_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists post_listings_author_idx on public.post_listings (author_id, created_at desc);
create index if not exists post_listings_group_idx on public.post_listings (listing_group_id);

alter table public.post_listings enable row level security;
alter table public.post_listings force row level security;
drop policy if exists "Authors read their listings" on public.post_listings;
create policy "Authors read their listings" on public.post_listings for select to authenticated using (author_id = auth.uid());
revoke all on public.post_listings from public, anon, authenticated;
grant select on public.post_listings to authenticated;
comment on table public.post_listings is 'Typed product and service details for public posts (ADR 0013). Written only through open_media_create_listing_post and open_media_update_listing.';

create or replace function app_private.listing_json(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', l.kind, 'title', l.title, 'priceMinor', l.price_minor, 'currency', l.currency,
    'location', l.location_text, 'remote', l.remote, 'availability', l.availability, 'groupId', l.listing_group_id
  )
  from public.post_listings l where l.post_id = p_post_id;
$$;

-- Public posts now carry their listing, when they have one.
create or replace function app_private.public_post_json(p_post public.posts, p_profile public.profiles)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_post.id,
    'body', p_post.body,
    'createdAt', p_post.created_at,
    'author', jsonb_build_object(
      'id', p_profile.id,
      'handle', p_profile.handle,
      'displayName', app_private.shown_name(p_profile),
      'avatarUrl', p_profile.avatar_url,
      'verified', app_private.is_verified(p_profile.id)
    ),
    'video', case when p_post.video_path is null then null else jsonb_build_object(
      'path', p_post.video_path,
      'posterPath', p_post.video_poster_path,
      'durationSeconds', p_post.video_duration_seconds,
      'width', p_post.video_width,
      'height', p_post.video_height,
      'contentType', p_post.video_content_type,
      'sha256', p_post.video_sha256
    ) end,
    'listing', app_private.listing_json(p_post.id)
  );
$$;

create or replace function public.open_media_create_listing_post(p_client_id uuid, p_body text, p_listing jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := btrim(coalesce(p_listing ->> 'title', ''));
  v_post jsonb;
  v_post_id uuid;
begin
  if v_user_id is null then raise exception 'A valid Open Media session is required.' using errcode = '42501'; end if;
  if p_listing is null or jsonb_typeof(p_listing) <> 'object' then raise exception 'The listing details are missing.' using errcode = '22023'; end if;
  if (p_listing ->> 'priceMinor') is not null and (p_listing ->> 'priceMinor') !~ '^\d{1,9}$' then
    raise exception 'The price must be a whole number of cents.' using errcode = '22023';
  end if;
  -- The post text defaults to the title, so a listing never needs a separate caption.
  v_post := app_private.create_post(p_client_id, coalesce(nullif(btrim(coalesce(p_body, '')), ''), v_title), null);
  v_post_id := (v_post ->> 'id')::uuid;
  begin
    insert into public.post_listings (post_id, author_id, kind, title, price_minor, currency, location_text, remote, availability)
    values (
      v_post_id, v_user_id, p_listing ->> 'kind', v_title,
      (p_listing ->> 'priceMinor')::bigint,
      coalesce(upper(p_listing ->> 'currency'), 'USD'),
      nullif(btrim(coalesce(p_listing ->> 'location', '')), ''),
      coalesce((p_listing ->> 'remote')::boolean, false),
      coalesce(p_listing ->> 'availability', 'available')
    )
    on conflict (post_id) do nothing;
  exception
    when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Check the listing: a product or service, a title up to 120 characters, a price, and a 3-letter currency.' using errcode = '22023';
  end;
  return v_post || jsonb_build_object('listing', app_private.listing_json(v_post_id));
end;
$$;

-- Authors can change the price, place and availability of their own listings.
create or replace function public.open_media_update_listing(p_post_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'A valid Open Media session is required.' using errcode = '42501'; end if;
  if (p_changes ->> 'priceMinor') is not null and (p_changes ->> 'priceMinor') !~ '^\d{1,9}$' then
    raise exception 'The price must be a whole number of cents.' using errcode = '22023';
  end if;
  update public.post_listings set
    price_minor = case when p_changes ? 'priceMinor' then (p_changes ->> 'priceMinor')::bigint else price_minor end,
    location_text = case when p_changes ? 'location' then nullif(btrim(coalesce(p_changes ->> 'location', '')), '') else location_text end,
    remote = coalesce((p_changes ->> 'remote')::boolean, remote),
    availability = coalesce(p_changes ->> 'availability', availability),
    updated_at = now()
  where post_id = p_post_id and author_id = auth.uid();
  if not found then raise exception 'Listing not found.' using errcode = 'P0002'; end if;
  return app_private.listing_json(p_post_id);
end;
$$;

revoke all on function app_private.listing_json(uuid) from public, anon;
grant execute on function app_private.listing_json(uuid) to authenticated;
revoke all on function public.open_media_create_listing_post(uuid, text, jsonb) from public, anon;
revoke all on function public.open_media_update_listing(uuid, jsonb) from public, anon;
grant execute on function public.open_media_create_listing_post(uuid, text, jsonb) to authenticated;
grant execute on function public.open_media_update_listing(uuid, jsonb) to authenticated;
