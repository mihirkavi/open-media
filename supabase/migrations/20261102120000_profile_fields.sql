-- Profile fields (ADR 0019): pronouns, location, website, contact details and accounts on other
-- social networks, each with its own visibility. The list of fields lives in
-- src/domain/profileFields.ts; this table keeps their values and who may see each one:
--
--   everyone     anyone who can see the profile
--   connections  people who follow you and whom you follow back, or who share a conversation with you
--   only_me      nobody but you
--
-- Rows are read only by their owner. Everyone else gets fields through open_media_public_profile,
-- which returns only what that viewer may see, so a private field never leaves the database.

create table if not exists public.profile_fields (
  user_id uuid not null references auth.users(id) on delete cascade,
  field text not null check (field ~ '^[a-z_]{1,24}$'),
  value text not null check (char_length(value) between 1 and 300),
  visibility text not null check (visibility in ('everyone', 'connections', 'only_me')),
  updated_at timestamptz not null default now(),
  primary key (user_id, field)
);

alter table public.profile_fields enable row level security;
alter table public.profile_fields force row level security;
drop policy if exists "People read their own profile fields" on public.profile_fields;
create policy "People read their own profile fields" on public.profile_fields for select to authenticated using (user_id = auth.uid());
revoke all on public.profile_fields from public, anon, authenticated;
grant select on public.profile_fields to authenticated;
comment on table public.profile_fields is 'Profile fields with per-field visibility (ADR 0019). Written only through open_media_set_profile_fields; others read them through open_media_public_profile.';

-- Mutual follows, or a shared conversation.
create or replace function app_private.is_connection(p_owner uuid, p_viewer uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_viewer is not null and p_owner is not null and p_viewer <> p_owner
    and not app_private.users_are_blocked(p_viewer, p_owner)
    and (
      (exists (select 1 from public.follows where follower_id = p_viewer and followee_id = p_owner and status = 'accepted')
       and exists (select 1 from public.follows where follower_id = p_owner and followee_id = p_viewer and status = 'accepted'))
      or app_private.shares_conversation(p_owner, p_viewer)
    );
$$;
revoke all on function app_private.is_connection(uuid, uuid) from public, anon, authenticated;

create or replace function app_private.visible_profile_fields(p_owner uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('field', f.field, 'value', f.value) order by f.field), '[]'::jsonb)
  from public.profile_fields f
  where f.user_id = p_owner
    and (f.visibility = 'everyone'
      or p_viewer = p_owner
      or (f.visibility = 'connections' and app_private.is_connection(p_owner, p_viewer)));
$$;
revoke all on function app_private.visible_profile_fields(uuid, uuid) from public, anon, authenticated;

-- Replaces the person's fields with the given list; an empty list clears them.
create or replace function public.open_media_set_profile_fields(p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'A valid Open Media session is required.' using errcode = '42501'; end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' or jsonb_array_length(p_fields) > 40 then
    raise exception 'Send up to 40 fields as a list.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = v_user) then raise exception 'Create your profile first.' using errcode = 'P0002'; end if;
  delete from public.profile_fields where user_id = v_user;
  begin
    insert into public.profile_fields (user_id, field, value, visibility)
    select v_user, item ->> 'field', btrim(item ->> 'value'), coalesce(item ->> 'visibility', 'everyone')
    from jsonb_array_elements(p_fields) item
    where nullif(btrim(coalesce(item ->> 'value', '')), '') is not null;
  exception when check_violation or not_null_violation or unique_violation then
    raise exception 'Check the profile fields: each needs a known field, a value up to 300 characters and a visibility of everyone, connections or only_me.' using errcode = '22023';
  end;
  return public.open_media_my_profile_fields();
end;
$$;

create or replace function public.open_media_my_profile_fields()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('field', field, 'value', value, 'visibility', visibility) order by field), '[]'::jsonb)
  from public.profile_fields where user_id = auth.uid();
$$;

revoke all on function public.open_media_set_profile_fields(jsonb) from public, anon;
revoke all on function public.open_media_my_profile_fields() from public, anon;
grant execute on function public.open_media_set_profile_fields(jsonb) to authenticated;
grant execute on function public.open_media_my_profile_fields() to authenticated;

-- Public profiles now carry the fields this viewer may see.
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
      'fields', app_private.visible_profile_fields(profile.id, auth.uid()),
      'postCount', (select count(*) from public.posts post where post.author_id = profile.id and post.removed_at is null),
      'canView', true,
      'followStatus', app_private.follow_status(auth.uid(), profile.id)
    )
    else app_private.profile_card(profile) || jsonb_build_object('canView', false, 'followStatus', app_private.follow_status(auth.uid(), profile.id))
  end
  from public.profiles profile
  where profile.handle = lower(p_handle);
$$;
