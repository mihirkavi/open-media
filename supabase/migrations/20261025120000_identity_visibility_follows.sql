-- Identity tiers, name disclosure, private accounts and follows (ADR 0013, phase 2).
--
-- Verification state is written only by the server (service role) after the identity provider
-- confirms it; clients can never set it. The tier and the name shown to others are computed here
-- and never accepted from clients. One access check, app_private.can_view_profile, decides what
-- every reader sees: the app, the public functions, the public API and MCP all go through it.

-- ─── Profile choices ─────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists name_disclosure text not null default 'declared'
    check (name_disclosure in ('handle_only', 'declared', 'verified_legal')),
  add column if not exists visibility text not null default 'public'
    check (visibility in ('public', 'private'));

comment on column public.profiles.name_disclosure is 'Which name others see: the handle only, the declared display name, or the verified legal name (only once verified).';
comment on column public.profiles.visibility is 'public: anyone can see posts and profile details. private: only accepted followers can.';

-- ─── Verification (server-written only) ──────────────────────────────────────

create table if not exists public.identity_verifications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null check (provider in ('stripe_identity')),
  provider_reference text not null unique check (char_length(provider_reference) between 1 and 200),
  status text not null check (status in ('pending', 'verified', 'failed', 'expired', 'revoked')),
  verified_at timestamptz,
  expires_at timestamptz,
  -- AES-256-GCM ciphertext from the Worker. Never plaintext, never sent to anyone but the owner.
  legal_name_ciphertext text check (legal_name_ciphertext is null or legal_name_ciphertext ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  -- Plain legal name only while the owner chooses to show it (tier 5); cleared otherwise.
  disclosed_legal_name text check (disclosed_legal_name is null or char_length(disclosed_legal_name) between 1 and 160),
  document_country text check (document_country is null or document_country ~ '^[A-Z]{2}$'),
  age_over_18 boolean,
  updated_at timestamptz not null default now()
);

alter table public.identity_verifications enable row level security;
alter table public.identity_verifications force row level security;
drop policy if exists "Owners read their verification" on public.identity_verifications;
create policy "Owners read their verification" on public.identity_verifications for select to authenticated using (user_id = auth.uid());
revoke all on public.identity_verifications from public, anon, authenticated;
grant select on public.identity_verifications to authenticated;
comment on table public.identity_verifications is 'Identity verification results from the provider (ADR 0013). Written only by the server; no document images or numbers are stored.';

create or replace function app_private.is_verified(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.identity_verifications v
    where v.user_id = p_user and v.status = 'verified' and (v.expires_at is null or v.expires_at > now())
  );
$$;

-- Tier 2: handle only. 3: declared name. 4: verified, legal name withheld. 5: verified, legal name shown.
create or replace function app_private.identity_tier(p_profile public.profiles)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app_private.is_verified(p_profile.id) and p_profile.name_disclosure = 'verified_legal'
      and exists (select 1 from public.identity_verifications v where v.user_id = p_profile.id and v.disclosed_legal_name is not null) then 5
    when app_private.is_verified(p_profile.id) then 4
    when p_profile.name_disclosure = 'handle_only' then 2
    else 3
  end;
$$;

-- The one name others may see. A withheld legal name never reaches this result.
create or replace function app_private.shown_name(p_profile public.profiles)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_profile.name_disclosure = 'verified_legal' and app_private.is_verified(p_profile.id)
      then coalesce((select v.disclosed_legal_name from public.identity_verifications v where v.user_id = p_profile.id), p_profile.display_name)
    when p_profile.name_disclosure = 'handle_only' then p_profile.handle
    else p_profile.display_name
  end;
$$;

-- Switching away from showing the legal name, or losing verification, removes the plain copy.
create or replace function app_private.clear_legal_name_on_disclosure_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name_disclosure is distinct from 'verified_legal' then
    update public.identity_verifications set disclosed_legal_name = null, updated_at = now()
    where user_id = new.id and disclosed_legal_name is not null;
  end if;
  return new;
end;
$$;

create or replace function app_private.clear_legal_name_when_unverified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'verified' then
    new.disclosed_legal_name := null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_clear_legal_name on public.profiles;
create trigger profiles_clear_legal_name after update of name_disclosure on public.profiles
  for each row execute function app_private.clear_legal_name_on_disclosure_change();
drop trigger if exists verifications_clear_legal_name on public.identity_verifications;
create trigger verifications_clear_legal_name before insert or update on public.identity_verifications
  for each row execute function app_private.clear_legal_name_when_unverified();

-- Server-only: record a provider result. Called by the Worker with the service role.
create or replace function public.open_media_record_verification(
  p_user uuid, p_provider text, p_reference text, p_status text,
  p_legal_name_ciphertext text default null, p_document_country text default null,
  p_age_over_18 boolean default null, p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.identity_verifications as v (user_id, provider, provider_reference, status, verified_at, expires_at, legal_name_ciphertext, document_country, age_over_18, updated_at)
  values (p_user, p_provider, p_reference, p_status, case when p_status = 'verified' then now() end, p_expires_at, p_legal_name_ciphertext, p_document_country, p_age_over_18, now())
  on conflict (user_id) do update set
    provider = excluded.provider,
    provider_reference = excluded.provider_reference,
    status = excluded.status,
    verified_at = case when excluded.status = 'verified' then now() else v.verified_at end,
    expires_at = excluded.expires_at,
    legal_name_ciphertext = coalesce(excluded.legal_name_ciphertext, case when excluded.status = 'verified' then v.legal_name_ciphertext end),
    document_country = coalesce(excluded.document_country, v.document_country),
    age_over_18 = coalesce(excluded.age_over_18, v.age_over_18),
    updated_at = now();
end;
$$;

-- Server-only: store the plain legal name once the verified owner chose to show it.
create or replace function public.open_media_set_disclosed_legal_name(p_user uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.is_verified(p_user) then raise exception 'not verified' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_user and name_disclosure = 'verified_legal') then
    raise exception 'legal name not chosen' using errcode = '42501';
  end if;
  update public.identity_verifications set disclosed_legal_name = nullif(btrim(p_name), ''), updated_at = now() where user_id = p_user;
end;
$$;

revoke all on function public.open_media_record_verification(uuid, text, text, text, text, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.open_media_set_disclosed_legal_name(uuid, text) from public, anon, authenticated;
grant execute on function public.open_media_record_verification(uuid, text, text, text, text, text, boolean, timestamptz) to service_role;
grant execute on function public.open_media_set_disclosed_legal_name(uuid, text) to service_role;

-- The verified legal name can be chosen only when verified; the server then fills it in.
create or replace function app_private.check_name_disclosure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name_disclosure = 'verified_legal' and not app_private.is_verified(new.id) then
    raise exception 'Verify your identity before showing your legal name.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_check_name_disclosure on public.profiles;
create trigger profiles_check_name_disclosure before insert or update of name_disclosure on public.profiles
  for each row execute function app_private.check_name_disclosure();

-- ─── Follows ─────────────────────────────────────────────────────────────────

create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followee_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index if not exists follows_followee_idx on public.follows (followee_id, status);

alter table public.follows enable row level security;
alter table public.follows force row level security;
drop policy if exists "People read their own follows" on public.follows;
create policy "People read their own follows" on public.follows for select to authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid());
revoke all on public.follows from public, anon, authenticated;
grant select on public.follows to authenticated;

create or replace function app_private.shares_conversation(p_first uuid, p_second uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members a
    join public.conversation_members b on a.conversation_id = b.conversation_id
    where a.user_id = p_first and b.user_id = p_second
  );
$$;

-- The single access rule (ADR 0013, 2.3). Blocks override everything.
create or replace function app_private.can_view_profile(p_viewer uuid, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_viewer is not null and p_viewer = p_owner then true
    when p_viewer is not null and app_private.users_are_blocked(p_viewer, p_owner) then false
    when (select visibility from public.profiles where id = p_owner) = 'public' then true
    when p_viewer is null then false
    else exists (select 1 from public.follows f where f.follower_id = p_viewer and f.followee_id = p_owner and f.status = 'accepted')
  end;
$$;

revoke all on function app_private.can_view_profile(uuid, uuid) from public, anon;
revoke all on function app_private.shares_conversation(uuid, uuid) from public, anon;
grant execute on function app_private.can_view_profile(uuid, uuid) to authenticated;
grant execute on function app_private.shares_conversation(uuid, uuid) to authenticated;
revoke all on function app_private.is_verified(uuid) from public, anon;
revoke all on function app_private.identity_tier(public.profiles) from public, anon;
revoke all on function app_private.shown_name(public.profiles) from public, anon;
grant execute on function app_private.is_verified(uuid) to authenticated;
grant execute on function app_private.identity_tier(public.profiles) to authenticated;
grant execute on function app_private.shown_name(public.profiles) to authenticated;

-- Profile rows: only your own. Everyone else is reached through the functions below, which return
-- the shown name and only the fields the viewer may see, so a withheld name never leaves the database.
drop policy if exists "Authenticated people can discover profiles" on public.profiles;
drop policy if exists "People read their own profile" on public.profiles;
create policy "People read their own profile" on public.profiles for select to authenticated
  using (id = auth.uid());

create or replace function app_private.follow_status(p_viewer uuid, p_owner uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_viewer is null or p_viewer = p_owner then null
    else (select status from public.follows where follower_id = p_viewer and followee_id = p_owner) end;
$$;

-- Fields anyone may see about any account, even a private one.
create or replace function app_private.profile_card(p_profile public.profiles)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_profile.id,
    'handle', p_profile.handle,
    'displayName', app_private.shown_name(p_profile),
    'avatarUrl', p_profile.avatar_url,
    'verified', app_private.is_verified(p_profile.id),
    'visibility', p_profile.visibility
  );
$$;

create or replace function public.open_media_follow(p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
  v_target public.profiles;
  v_status text;
begin
  if v_viewer is null then raise exception 'Sign in to follow people.' using errcode = '42501'; end if;
  select * into v_target from public.profiles where handle = lower(ltrim(p_handle, '@'));
  if v_target.id is null or app_private.users_are_blocked(v_viewer, v_target.id) then raise exception 'Profile not found.' using errcode = 'P0002'; end if;
  if v_target.id = v_viewer then raise exception 'You cannot follow yourself.' using errcode = '22023'; end if;
  if (select count(*) from public.follows where follower_id = v_viewer and created_at > now() - interval '1 hour') >= 200 then
    raise exception 'Too many follows. Try again later.' using errcode = '54000';
  end if;
  v_status := case when v_target.visibility = 'public' then 'accepted' else 'pending' end;
  insert into public.follows (follower_id, followee_id, status) values (v_viewer, v_target.id, v_status)
  on conflict (follower_id, followee_id) do nothing;
  return jsonb_build_object('handle', v_target.handle, 'status', (select status from public.follows where follower_id = v_viewer and followee_id = v_target.id));
end;
$$;

create or replace function public.open_media_unfollow(p_handle text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with target as (select id, handle from public.profiles where handle = lower(ltrim(p_handle, '@'))),
  removed as (delete from public.follows using target where follower_id = auth.uid() and followee_id = target.id returning 1)
  select jsonb_build_object('handle', (select handle from target), 'status', null, 'removed', (select count(*) from removed));
$$;

create or replace function public.open_media_answer_follow_request(p_follower uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_accept then
    update public.follows set status = 'accepted' where follower_id = p_follower and followee_id = auth.uid() and status = 'pending';
  else
    delete from public.follows where follower_id = p_follower and followee_id = auth.uid() and status = 'pending';
  end if;
  return jsonb_build_object('follower', p_follower, 'accepted', p_accept);
end;
$$;

create or replace function public.open_media_remove_follower(p_follower uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with removed as (delete from public.follows where follower_id = p_follower and followee_id = auth.uid() returning 1)
  select jsonb_build_object('follower', p_follower, 'removed', (select count(*) from removed));
$$;

create or replace function public.open_media_my_follows()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'following', coalesce((select jsonb_agg(app_private.profile_card(p) || jsonb_build_object('status', f.status) order by f.created_at desc)
      from public.follows f join public.profiles p on p.id = f.followee_id where f.follower_id = auth.uid()), '[]'::jsonb),
    'followers', coalesce((select jsonb_agg(app_private.profile_card(p) order by f.created_at desc)
      from public.follows f join public.profiles p on p.id = f.follower_id where f.followee_id = auth.uid() and f.status = 'accepted'), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(app_private.profile_card(p) || jsonb_build_object('requestedAt', f.created_at) order by f.created_at desc)
      from public.follows f join public.profiles p on p.id = f.follower_id where f.followee_id = auth.uid() and f.status = 'pending'), '[]'::jsonb)
  );
$$;

-- Making an account public again turns waiting requests into follows.
create or replace function app_private.accept_requests_when_public()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.visibility = 'public' and old.visibility = 'private' then
    update public.follows set status = 'accepted' where followee_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_accept_requests on public.profiles;
create trigger profiles_accept_requests after update of visibility on public.profiles
  for each row execute function app_private.accept_requests_when_public();

-- My identity: tier, choices and verification status (never the ciphertext).
create or replace function public.open_media_my_identity()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tier', app_private.identity_tier(p),
    'verified', app_private.is_verified(p.id),
    'shownName', app_private.shown_name(p),
    'nameDisclosure', p.name_disclosure,
    'visibility', p.visibility,
    'verification', (select jsonb_build_object('provider', v.provider, 'status', v.status, 'verifiedAt', v.verified_at, 'expiresAt', v.expires_at,
      'legalNameShown', v.disclosed_legal_name is not null, 'documentCountry', v.document_country)
      from public.identity_verifications v where v.user_id = p.id),
    'pendingRequests', (select count(*) from public.follows f where f.followee_id = p.id and f.status = 'pending')
  )
  from public.profiles p where p.id = auth.uid();
$$;

-- Shown names for people in your conversations or search results.
create or replace function public.open_media_profile_cards(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app_private.profile_card(p)), '[]'::jsonb)
  from public.profiles p
  where p.id = any(p_ids[1:200]) and auth.uid() is not null and not app_private.users_are_blocked(auth.uid(), p.id);
$$;

create or replace function public.open_media_search_profiles(p_query text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with pattern as (select '%' || replace(replace(replace(lower(btrim(ltrim(p_query, '@'))), '\', '\\'), '%', '\%'), '_', '\_') || '%' as value)
  select coalesce(jsonb_agg(card), '[]'::jsonb) from (
    select app_private.profile_card(p) as card
    from public.profiles p, pattern
    where auth.uid() is not null and char_length(btrim(p_query)) >= 2 and p.id <> auth.uid()
      and not app_private.users_are_blocked(auth.uid(), p.id)
      and (p.handle like pattern.value or (p.name_disclosure = 'declared' and lower(p.display_name) like pattern.value))
    order by p.handle
    limit 20
  ) results;
$$;

do $$
declare name text;
begin
  foreach name in array array[
    'open_media_follow(text)', 'open_media_unfollow(text)', 'open_media_answer_follow_request(uuid, boolean)', 'open_media_remove_follower(uuid)',
    'open_media_my_follows()', 'open_media_my_identity()', 'open_media_profile_cards(uuid[])', 'open_media_search_profiles(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', name);
    execute format('grant execute on function public.%s to authenticated', name);
  end loop;
end $$;

-- ─── Public readers respect the access rule ─────────────────────────────────

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
    ) end
  );
$$;

create or replace function public.open_media_public_posts(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_author_handle text default null,
  p_media text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item.post order by item.created_at desc, item.id desc), '[]'::jsonb)
  from (
    select app_private.public_post_json(post, profile) as post, post.created_at, post.id
    from public.posts post
    join public.profiles profile on profile.id = post.author_id
    where post.removed_at is null
      and (p_author_handle is null or profile.handle = lower(p_author_handle))
      and (p_media is distinct from 'video' or post.video_path is not null)
      and (
        p_before_created_at is null
        or (post.created_at, post.id) < (p_before_created_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
      )
      and app_private.can_view_profile(auth.uid(), post.author_id)
    order by post.created_at desc, post.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) item;
$$;

create or replace function public.open_media_public_post(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.public_post_json(post, profile)
  from public.posts post
  join public.profiles profile on profile.id = post.author_id
  where post.id = p_post_id and post.removed_at is null and app_private.can_view_profile(auth.uid(), post.author_id);
$$;

-- A private profile shows only its card (handle, shown name, avatar, tick) until you may view it.
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
      'postCount', (select count(*) from public.posts post where post.author_id = profile.id and post.removed_at is null),
      'canView', true,
      'followStatus', app_private.follow_status(auth.uid(), profile.id)
    )
    else app_private.profile_card(profile) || jsonb_build_object('canView', false, 'followStatus', app_private.follow_status(auth.uid(), profile.id))
  end
  from public.profiles profile
  where profile.handle = lower(p_handle);
$$;

revoke all on function public.open_media_public_profile(text) from public;
grant execute on function public.open_media_public_profile(text) to anon, authenticated;
revoke all on function public.open_media_public_post(uuid) from public;
grant execute on function public.open_media_public_post(uuid) to anon, authenticated;
revoke all on function public.open_media_public_posts(integer, timestamptz, uuid, text, text) from public;
grant execute on function public.open_media_public_posts(integer, timestamptz, uuid, text, text) to anon, authenticated;
