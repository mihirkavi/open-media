-- Likes, comments and reshares on web feed items (ADR 0024 §8).
--
-- RSS, Atom and JSON Feed items aren't Open Media posts, so the Feed's comment, reshare and like
-- icons act on them here, keyed by the article's link (https only, normalised by the app: tracking
-- parameters and the #fragment removed). Everyone following a feed with that article sees the same
-- counts and comments; nothing is sent to the publisher. Like post interactions, every table is
-- written only through the security-definer functions below, comments by people the viewer can't
-- see are left out, and people read their own rows directly for the account export.

create table if not exists public.web_item_likes (
  item_url text not null check (item_url ~ '^https://' and char_length(item_url) <= 2048),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_url, user_id)
);

create table if not exists public.web_item_reshares (
  item_url text not null check (item_url ~ '^https://' and char_length(item_url) <= 2048),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_url, user_id)
);

create table if not exists public.web_item_comments (
  id uuid primary key default gen_random_uuid(),
  item_url text not null check (item_url ~ '^https://' and char_length(item_url) <= 2048),
  author_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (author_id, client_id)
);

create index if not exists web_item_likes_user_idx on public.web_item_likes (user_id, created_at desc);
create index if not exists web_item_reshares_user_idx on public.web_item_reshares (user_id, created_at desc);
create index if not exists web_item_comments_item_idx on public.web_item_comments (item_url, created_at, id) where removed_at is null;
create index if not exists web_item_comments_author_idx on public.web_item_comments (author_id, created_at desc);

alter table public.web_item_likes enable row level security;
alter table public.web_item_reshares enable row level security;
alter table public.web_item_comments enable row level security;
alter table public.web_item_likes force row level security;
alter table public.web_item_reshares force row level security;
alter table public.web_item_comments force row level security;

drop policy if exists "People read their own web item likes" on public.web_item_likes;
create policy "People read their own web item likes" on public.web_item_likes for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "People read their own web item reshares" on public.web_item_reshares;
create policy "People read their own web item reshares" on public.web_item_reshares for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "People read their own web item comments" on public.web_item_comments;
create policy "People read their own web item comments" on public.web_item_comments for select to authenticated using ((select auth.uid()) = author_id);

revoke all on public.web_item_likes, public.web_item_reshares, public.web_item_comments from public, anon, authenticated;
grant select on public.web_item_likes, public.web_item_reshares, public.web_item_comments to authenticated;

create or replace function app_private.valid_web_item_url(p_url text)
returns boolean language sql immutable set search_path = ''
as $$ select p_url is not null and p_url ~ '^https://[^/?#\s]+' and char_length(p_url) <= 2048 and p_url !~ '\s'; $$;
revoke all on function app_private.valid_web_item_url(text) from public;
grant execute on function app_private.valid_web_item_url(text) to anon, authenticated;

create or replace function app_private.require_web_item_actor(p_url text)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
begin
  if v_viewer is null then raise exception 'Sign in to like, comment, or reshare.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_viewer) then
    raise exception 'Create your Open Media profile first.' using errcode = '42501';
  end if;
  if not app_private.valid_web_item_url(p_url) then
    raise exception 'That item has no web address to attach this to.' using errcode = '22023';
  end if;
  return v_viewer;
end;
$$;
revoke all on function app_private.require_web_item_actor(text) from public, anon;
grant execute on function app_private.require_web_item_actor(text) to authenticated;

create or replace function app_private.web_item_engagement_json(p_url text, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'replies', (select count(*) from public.web_item_comments c where c.item_url = p_url and c.removed_at is null and app_private.can_view_profile(p_viewer, c.author_id)),
    'reposts', (select count(*) from public.web_item_reshares r where r.item_url = p_url),
    'likes', (select count(*) from public.web_item_likes l where l.item_url = p_url),
    'liked', p_viewer is not null and exists (select 1 from public.web_item_likes l where l.item_url = p_url and l.user_id = p_viewer),
    'reshared', p_viewer is not null and exists (select 1 from public.web_item_reshares r where r.item_url = p_url and r.user_id = p_viewer)
  );
$$;
revoke all on function app_private.web_item_engagement_json(text, uuid) from public, anon;
grant execute on function app_private.web_item_engagement_json(text, uuid) to anon, authenticated;

-- Counts for up to 100 items at once, keyed by URL; signed out, without the viewer's own state.
create or replace function public.open_media_web_item_engagement(p_urls text[])
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(url, app_private.web_item_engagement_json(url, auth.uid())), '{}'::jsonb)
  from (select distinct url from unnest(coalesce(p_urls, '{}'::text[])) url where app_private.valid_web_item_url(url) limit 100) item;
$$;

create or replace function public.open_media_set_web_item_like(p_url text, p_liked boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_viewer uuid := app_private.require_web_item_actor(p_url);
begin
  if p_liked then
    insert into public.web_item_likes (item_url, user_id) values (p_url, v_viewer) on conflict do nothing;
  else
    delete from public.web_item_likes where item_url = p_url and user_id = v_viewer;
  end if;
  return app_private.web_item_engagement_json(p_url, v_viewer);
end;
$$;

create or replace function public.open_media_set_web_item_reshare(p_url text, p_reshared boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_viewer uuid := app_private.require_web_item_actor(p_url);
begin
  if p_reshared then
    insert into public.web_item_reshares (item_url, user_id) values (p_url, v_viewer) on conflict do nothing;
  else
    delete from public.web_item_reshares where item_url = p_url and user_id = v_viewer;
  end if;
  return app_private.web_item_engagement_json(p_url, v_viewer);
end;
$$;

create or replace function app_private.web_item_comment_json(p_comment public.web_item_comments, p_profile public.profiles)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_comment.id,
    'itemUrl', p_comment.item_url,
    'body', p_comment.body,
    'createdAt', p_comment.created_at,
    'author', jsonb_build_object(
      'id', p_profile.id,
      'handle', p_profile.handle,
      'displayName', app_private.shown_name(p_profile),
      'avatarUrl', p_profile.avatar_url,
      'verified', app_private.is_verified(p_profile.id)
    )
  );
$$;
revoke all on function app_private.web_item_comment_json(public.web_item_comments, public.profiles) from public, anon;
grant execute on function app_private.web_item_comment_json(public.web_item_comments, public.profiles) to anon, authenticated;

-- Idempotent on the client ID, so a retried send never comments twice. Comments on posts and on web
-- items share one limit of 60 an hour.
create or replace function public.open_media_add_web_item_comment(p_url text, p_client_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_viewer uuid := app_private.require_web_item_actor(p_url);
  v_body text := btrim(coalesce(p_body, ''));
  v_comment public.web_item_comments;
begin
  if p_client_id is null then raise exception 'A comment client ID is required.' using errcode = '22023'; end if;
  if char_length(v_body) not between 1 and 1000 then raise exception 'Comments must be between 1 and 1000 characters.' using errcode = '22023'; end if;
  select * into v_comment from public.web_item_comments where author_id = v_viewer and client_id = p_client_id;
  if v_comment.id is null then
    if (select count(*) from public.web_item_comments where author_id = v_viewer and created_at > now() - interval '1 hour')
       + (select count(*) from public.post_comments where author_id = v_viewer and created_at > now() - interval '1 hour') >= 60 then
      raise exception 'Too many comments. Try again later.' using errcode = '54000';
    end if;
    insert into public.web_item_comments (item_url, author_id, client_id, body) values (p_url, v_viewer, p_client_id, v_body) returning * into v_comment;
  end if;
  return app_private.web_item_comment_json(v_comment, (select profile from public.profiles profile where profile.id = v_viewer));
end;
$$;

-- Oldest first, like a conversation. Comments by people the viewer cannot see are left out.
create or replace function public.open_media_web_item_comments(p_url text, p_limit integer default 50)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(item.comment order by item.created_at, item.id), '[]'::jsonb)
  from (
    select app_private.web_item_comment_json(comment, profile) as comment, comment.created_at, comment.id
    from public.web_item_comments comment
    join public.profiles profile on profile.id = comment.author_id
    where comment.item_url = p_url and comment.removed_at is null
      and app_private.can_view_profile(auth.uid(), comment.author_id)
    order by comment.created_at, comment.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) item;
$$;

revoke all on function public.open_media_web_item_engagement(text[]) from public;
revoke all on function public.open_media_set_web_item_like(text, boolean) from public, anon;
revoke all on function public.open_media_set_web_item_reshare(text, boolean) from public, anon;
revoke all on function public.open_media_add_web_item_comment(text, uuid, text) from public, anon;
revoke all on function public.open_media_web_item_comments(text, integer) from public;
grant execute on function public.open_media_web_item_engagement(text[]) to anon, authenticated;
grant execute on function public.open_media_set_web_item_like(text, boolean) to authenticated;
grant execute on function public.open_media_set_web_item_reshare(text, boolean) to authenticated;
grant execute on function public.open_media_add_web_item_comment(text, uuid, text) to authenticated;
grant execute on function public.open_media_web_item_comments(text, integer) to anon, authenticated;

comment on table public.web_item_likes is 'Likes on web feed items, keyed by article URL (ADR 0024). Written only through functions.';
comment on table public.web_item_reshares is 'Reshares of web feed items, keyed by article URL (ADR 0024). Written only through functions.';
comment on table public.web_item_comments is 'Public comments on web feed items, keyed by article URL (ADR 0024). Written only through functions.';
