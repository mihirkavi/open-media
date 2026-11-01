-- Your own feed algorithm (ADR 0021). People now develop a lens a little at a time ("less hive",
-- "more videos"), so every change is kept as a version: the person can see what changed, whether
-- they or an agent changed it, and go back. The database assigns the version number. Shared lenses
-- can be audited by anyone, but only for the versions made while they were shared. Installs stay
-- copies, so an author changing a shared lens never changes what other people installed.

alter table public.feed_lenses add column if not exists version integer not null default 1 check (version >= 1);
comment on column public.feed_lenses.version is 'Assigned by open_media_save_feed_lens: +1 whenever the manifest or name changes (ADR 0021).';

create table if not exists public.feed_lens_versions (
  lens_id uuid not null references public.feed_lenses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version >= 1),
  name text not null,
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object' and pg_column_size(manifest) <= 8192),
  visibility text not null check (visibility in ('private', 'public')),
  changed_by text not null check (changed_by in ('app', 'agent')),
  created_at timestamptz not null default now(),
  primary key (lens_id, version)
);

create index if not exists feed_lens_versions_owner_idx on public.feed_lens_versions (owner_id, created_at desc);

alter table public.feed_lens_versions enable row level security;
alter table public.feed_lens_versions force row level security;
drop policy if exists "People read their own lens versions" on public.feed_lens_versions;
create policy "People read their own lens versions" on public.feed_lens_versions for select to authenticated using (owner_id = auth.uid());
revoke all on public.feed_lens_versions from public, anon, authenticated;
grant select on public.feed_lens_versions to authenticated;
comment on table public.feed_lens_versions is 'Every version of every feed lens (ADR 0021). Written only by open_media_save_feed_lens; at most 50 kept per lens.';

-- Lenses saved before this change start their history at version 1.
update public.feed_lenses set version = 1, manifest = manifest || jsonb_build_object('version', 1) where version = 1 and manifest ->> 'version' is distinct from '1';
insert into public.feed_lens_versions (lens_id, owner_id, version, name, manifest, visibility, changed_by, created_at)
select id, owner_id, 1, name, manifest, visibility, 'app', updated_at from public.feed_lenses
on conflict do nothing;

create or replace function app_private.feed_lens_json(p_lens public.feed_lenses, p_with_owner boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_lens.id,
    'key', p_lens.lens_key,
    'name', p_lens.name,
    'manifest', p_lens.manifest,
    'version', p_lens.version,
    'visibility', p_lens.visibility,
    'forkedFrom', p_lens.forked_from,
    'installs', (select count(*) from public.feed_lenses c where c.forked_from = p_lens.id and c.owner_id <> p_lens.owner_id),
    'createdAt', p_lens.created_at,
    'updatedAt', p_lens.updated_at
  ) || case when p_with_owner then jsonb_build_object(
    -- Private accounts can share a lens without revealing who they are.
    'author', (select case when pr.visibility = 'public' then jsonb_build_object('handle', pr.handle, 'displayName', pr.display_name) else null end from public.profiles pr where pr.id = p_lens.owner_id)
  ) else '{}'::jsonb end;
$$;

create or replace function app_private.feed_lens_version_json(p_version public.feed_lens_versions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('version', p_version.version, 'name', p_version.name, 'manifest', p_version.manifest, 'visibility', p_version.visibility, 'changedBy', p_version.changed_by, 'createdAt', p_version.created_at);
$$;

drop function if exists public.open_media_save_feed_lens(text, text, jsonb, text, uuid);

create or replace function public.open_media_save_feed_lens(p_key text, p_name text, p_manifest jsonb, p_visibility text default 'private', p_forked_from uuid default null, p_changed_by text default 'app')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.feed_lenses;
  v_name text := btrim(coalesce(p_name, ''));
  v_manifest jsonb;
  v_changed boolean := true;
  v_version integer := 1;
begin
  if v_user is null then raise exception 'Sign in to save a lens.' using errcode = '42501'; end if;
  if p_visibility not in ('private', 'public') then raise exception 'visibility must be private or public.' using errcode = '22023'; end if;
  if p_changed_by not in ('app', 'agent') then raise exception 'changed_by must be app or agent.' using errcode = '22023'; end if;
  if jsonb_typeof(p_manifest) is distinct from 'object' then raise exception 'A lens manifest must be an object.' using errcode = '23514'; end if;
  v_manifest := p_manifest - 'version';
  if p_forked_from is not null and not exists (select 1 from public.feed_lenses where id = p_forked_from and (visibility = 'public' or owner_id = v_user)) then
    raise exception 'That lens is not shared.' using errcode = '22023';
  end if;

  select * into v_row from public.feed_lenses where owner_id = v_user and lens_key = p_key for update;
  if found then
    -- Saving the same manifest and name again (for example only sharing it) is not a new version.
    v_changed := (v_row.manifest - 'version') is distinct from v_manifest or v_row.name is distinct from v_name;
    v_version := v_row.version + case when v_changed then 1 else 0 end;
  elsif (select count(*) from public.feed_lenses where owner_id = v_user) >= 50 then
    raise exception 'You can keep up to 50 lenses. Remove one first.' using errcode = '22023';
  end if;
  if v_changed and (select count(*) from public.feed_lens_versions where owner_id = v_user and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'That is a lot of changes in an hour. Try again later.' using errcode = '22023';
  end if;

  insert into public.feed_lenses (owner_id, lens_key, name, manifest, visibility, forked_from, version)
  values (v_user, p_key, v_name, v_manifest || jsonb_build_object('version', v_version), p_visibility, p_forked_from, v_version)
  on conflict (owner_id, lens_key) do update
    set name = excluded.name, manifest = excluded.manifest, visibility = excluded.visibility, version = excluded.version,
        forked_from = coalesce(public.feed_lenses.forked_from, excluded.forked_from),
        updated_at = case when v_changed or public.feed_lenses.visibility <> excluded.visibility then now() else public.feed_lenses.updated_at end
  returning * into v_row;

  if v_changed then
    insert into public.feed_lens_versions (lens_id, owner_id, version, name, manifest, visibility, changed_by)
    values (v_row.id, v_user, v_row.version, v_row.name, v_row.manifest, v_row.visibility, p_changed_by)
    on conflict (lens_id, version) do nothing;
    delete from public.feed_lens_versions where lens_id = v_row.id and version <= v_row.version - 50;
  elsif v_row.visibility = 'public' then
    -- Sharing an unchanged lens makes its current version auditable.
    update public.feed_lens_versions set visibility = 'public' where lens_id = v_row.id and version = v_row.version;
  end if;
  return app_private.feed_lens_json(v_row, true);
end;
$$;

-- The person's own history of one lens, newest first.
create or replace function public.open_media_feed_lens_history(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app_private.feed_lens_version_json(v) order by v.version desc), '[]'::jsonb)
  from public.feed_lens_versions v
  join public.feed_lenses l on l.id = v.lens_id
  where l.owner_id = auth.uid() and l.lens_key = p_key;
$$;

-- Going back saves the old version as the newest one, so going back can itself be undone.
create or replace function public.open_media_revert_feed_lens(p_key text, p_version integer, p_changed_by text default 'app')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lens public.feed_lenses;
  v_old public.feed_lens_versions;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into v_lens from public.feed_lenses where owner_id = auth.uid() and lens_key = p_key;
  if not found then raise exception 'No lens with that key.' using errcode = 'P0002'; end if;
  select * into v_old from public.feed_lens_versions where lens_id = v_lens.id and version = p_version;
  if not found then raise exception 'That version is not kept any more.' using errcode = 'P0002'; end if;
  return public.open_media_save_feed_lens(p_key, v_old.name, v_old.manifest, v_lens.visibility, null, p_changed_by);
end;
$$;

-- Anyone can audit a shared lens: the versions made while it was shared, newest first.
create or replace function public.open_media_public_feed_lens_history(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app_private.feed_lens_version_json(v) - 'visibility' order by v.version desc), '[]'::jsonb)
  from public.feed_lens_versions v
  join public.feed_lenses l on l.id = v.lens_id
  where l.id = p_id and l.visibility = 'public' and v.visibility = 'public';
$$;

revoke all on function app_private.feed_lens_json(public.feed_lenses, boolean) from public, anon, authenticated;
revoke all on function app_private.feed_lens_version_json(public.feed_lens_versions) from public, anon, authenticated;
revoke all on function public.open_media_save_feed_lens(text, text, jsonb, text, uuid, text) from public, anon;
revoke all on function public.open_media_feed_lens_history(text) from public, anon;
revoke all on function public.open_media_revert_feed_lens(text, integer, text) from public, anon;
revoke all on function public.open_media_public_feed_lens_history(uuid) from public;
grant execute on function public.open_media_save_feed_lens(text, text, jsonb, text, uuid, text) to authenticated;
grant execute on function public.open_media_feed_lens_history(text) to authenticated;
grant execute on function public.open_media_revert_feed_lens(text, integer, text) to authenticated;
grant execute on function public.open_media_public_feed_lens_history(uuid) to anon, authenticated;
