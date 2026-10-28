-- Feed lenses (ADR 0017). A lens is a small JSON manifest that says how the Feed is filtered and
-- ordered; Raw and Relevant are the two built in. People keep their own lenses here so they follow
-- them across devices and agents, and may share one publicly so anyone can inspect, install or fork
-- it. The manifest is data, never code: clients and the Worker run it with one open-source runner
-- (src/domain/feedLenses.ts) over posts they already loaded. Nothing here gives a lens access to
-- other tables. Installs are counted as copies (forked_from), so there is no counter to inflate.

create table if not exists public.feed_lenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lens_key text not null check (lens_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$' and lens_key not in ('raw', 'relevant')),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object' and pg_column_size(manifest) <= 8192),
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  forked_from uuid references public.feed_lenses(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, lens_key)
);

create index if not exists feed_lenses_public_idx on public.feed_lenses (updated_at desc) where visibility = 'public';
create index if not exists feed_lenses_forked_idx on public.feed_lenses (forked_from) where forked_from is not null;

alter table public.feed_lenses enable row level security;
alter table public.feed_lenses force row level security;
drop policy if exists "People read their own lenses" on public.feed_lenses;
create policy "People read their own lenses" on public.feed_lenses for select to authenticated using (owner_id = auth.uid());
revoke all on public.feed_lenses from public, anon, authenticated;
grant select on public.feed_lenses to authenticated;
comment on table public.feed_lenses is 'Feed lens manifests (ADR 0017). Written only through open_media_save_feed_lens; public ones are read through open_media_public_feed_lenses.';

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

create or replace function public.open_media_save_feed_lens(p_key text, p_name text, p_manifest jsonb, p_visibility text default 'private', p_forked_from uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.feed_lenses;
begin
  if v_user is null then raise exception 'Sign in to save a lens.' using errcode = '42501'; end if;
  if p_visibility not in ('private', 'public') then raise exception 'visibility must be private or public.' using errcode = '22023'; end if;
  if p_forked_from is not null and not exists (select 1 from public.feed_lenses where id = p_forked_from and (visibility = 'public' or owner_id = v_user)) then
    raise exception 'That lens is not shared.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.feed_lenses where owner_id = v_user and lens_key = p_key)
     and (select count(*) from public.feed_lenses where owner_id = v_user) >= 50 then
    raise exception 'You can keep up to 50 lenses. Remove one first.' using errcode = '22023';
  end if;
  insert into public.feed_lenses (owner_id, lens_key, name, manifest, visibility, forked_from)
  values (v_user, p_key, btrim(p_name), p_manifest, p_visibility, p_forked_from)
  on conflict (owner_id, lens_key) do update
    set name = excluded.name, manifest = excluded.manifest, visibility = excluded.visibility,
        forked_from = coalesce(public.feed_lenses.forked_from, excluded.forked_from), updated_at = now()
  returning * into v_row;
  return app_private.feed_lens_json(v_row, true);
end;
$$;

create or replace function public.open_media_my_feed_lenses()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app_private.feed_lens_json(l, false) order by l.updated_at desc), '[]'::jsonb)
  from public.feed_lenses l where l.owner_id = auth.uid();
$$;

create or replace function public.open_media_delete_feed_lens(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  delete from public.feed_lenses where owner_id = auth.uid() and lens_key = p_key;
  return jsonb_build_object('deleted', found);
end;
$$;

-- The public directory: shared lenses, newest first, optionally matching words in the name or manifest.
create or replace function public.open_media_public_feed_lenses(p_query text default null, p_limit integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by updated desc), '[]'::jsonb) from (
    select app_private.feed_lens_json(l, true) as item, l.updated_at as updated
    from public.feed_lenses l
    where l.visibility = 'public'
      and (nullif(btrim(coalesce(p_query, '')), '') is null
        or l.name ilike '%' || replace(replace(btrim(p_query), '%', ''), '_', '') || '%'
        or l.manifest::text ilike '%' || replace(replace(btrim(p_query), '%', ''), '_', '') || '%')
    order by l.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 30), 100))
  ) found;
$$;

create or replace function public.open_media_public_feed_lens(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.feed_lens_json(l, true) from public.feed_lenses l where l.id = p_id and l.visibility = 'public';
$$;

revoke all on function app_private.feed_lens_json(public.feed_lenses, boolean) from public, anon, authenticated;
revoke all on function public.open_media_save_feed_lens(text, text, jsonb, text, uuid) from public, anon;
revoke all on function public.open_media_my_feed_lenses() from public, anon;
revoke all on function public.open_media_delete_feed_lens(text) from public, anon;
revoke all on function public.open_media_public_feed_lenses(text, integer) from public;
revoke all on function public.open_media_public_feed_lens(uuid) from public;
grant execute on function public.open_media_save_feed_lens(text, text, jsonb, text, uuid) to authenticated;
grant execute on function public.open_media_my_feed_lenses() to authenticated;
grant execute on function public.open_media_delete_feed_lens(text) to authenticated;
grant execute on function public.open_media_public_feed_lenses(text, integer) to anon, authenticated;
grant execute on function public.open_media_public_feed_lens(uuid) to anon, authenticated;
