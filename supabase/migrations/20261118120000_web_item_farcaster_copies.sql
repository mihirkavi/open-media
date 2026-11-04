-- Farcaster copies of likes, reshares and comments on web feed items and public events
-- (ADR 0024 addendum 2, 2026-11-03).
--
-- Open Media keeps its own record of every action on an article or event link (20261116120000).
-- When the person also has Farcaster connected for cross-posting, the app sends the same action to
-- Farcaster in the protocol's own form for a link (a reaction whose target is the URL, a cast whose
-- parent is the URL), so every Farcaster app can see it. These columns note which Open Media rows
-- have a Farcaster copy, so counts that add Farcaster's own never count one person twice. They hold
-- only the public Farcaster account number (fid) and cast hash, both already public on Farcaster.

alter table public.web_item_likes add column if not exists farcaster_fid bigint check (farcaster_fid > 0);
alter table public.web_item_reshares add column if not exists farcaster_fid bigint check (farcaster_fid > 0);
alter table public.web_item_comments add column if not exists farcaster_hash text check (farcaster_hash ~ '^0x[0-9a-f]{40}$');

-- Counts now also say which Farcaster accounts the Open Media likes and reshares were copied to,
-- and which casts copy its comments.
create or replace function app_private.web_item_engagement_json(p_url text, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'replies', (select count(*) from public.web_item_comments c where c.item_url = p_url and c.removed_at is null and app_private.can_view_profile(p_viewer, c.author_id)),
    'reposts', (select count(*) from public.web_item_reshares r where r.item_url = p_url),
    'likes', (select count(*) from public.web_item_likes l where l.item_url = p_url),
    'liked', p_viewer is not null and exists (select 1 from public.web_item_likes l where l.item_url = p_url and l.user_id = p_viewer),
    'reshared', p_viewer is not null and exists (select 1 from public.web_item_reshares r where r.item_url = p_url and r.user_id = p_viewer),
    'farcasterCopies', jsonb_build_object(
      'likes', coalesce((select jsonb_agg(fid) from (select l.farcaster_fid as fid from public.web_item_likes l where l.item_url = p_url and l.farcaster_fid is not null limit 200) item), '[]'::jsonb),
      'reshares', coalesce((select jsonb_agg(fid) from (select r.farcaster_fid as fid from public.web_item_reshares r where r.item_url = p_url and r.farcaster_fid is not null limit 200) item), '[]'::jsonb),
      'comments', coalesce((select jsonb_agg(hash) from (select c.farcaster_hash as hash from public.web_item_comments c where c.item_url = p_url and c.farcaster_hash is not null and c.removed_at is null limit 200) item), '[]'::jsonb)
    )
  );
$$;

create or replace function app_private.web_item_comment_json(p_comment public.web_item_comments, p_profile public.profiles)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_comment.id,
    'itemUrl', p_comment.item_url,
    'body', p_comment.body,
    'createdAt', p_comment.created_at,
    'farcasterHash', p_comment.farcaster_hash,
    'author', jsonb_build_object(
      'id', p_profile.id,
      'handle', p_profile.handle,
      'displayName', app_private.shown_name(p_profile),
      'avatarUrl', p_profile.avatar_url,
      'verified', app_private.is_verified(p_profile.id)
    )
  );
$$;

-- Notes that the viewer's own like, reshare or comment now has a Farcaster copy. Only the viewer's
-- own rows can be marked. Returns the item's counts.
create or replace function public.open_media_note_web_item_farcaster_copy(p_url text, p_kind text, p_fid bigint, p_comment_id uuid default null, p_hash text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_viewer uuid := app_private.require_web_item_actor(p_url);
begin
  if p_fid is null or p_fid <= 0 then raise exception 'A Farcaster account number is required.' using errcode = '22023'; end if;
  if p_kind = 'like' then
    update public.web_item_likes set farcaster_fid = p_fid where item_url = p_url and user_id = v_viewer;
  elsif p_kind = 'reshare' then
    update public.web_item_reshares set farcaster_fid = p_fid where item_url = p_url and user_id = v_viewer;
  elsif p_kind = 'comment' then
    if p_hash is null or p_hash !~ '^0x[0-9a-f]{40}$' then raise exception 'A Farcaster cast hash is required.' using errcode = '22023'; end if;
    update public.web_item_comments set farcaster_hash = p_hash where id = p_comment_id and item_url = p_url and author_id = v_viewer;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  return app_private.web_item_engagement_json(p_url, v_viewer);
end;
$$;

revoke all on function public.open_media_note_web_item_farcaster_copy(text, text, bigint, uuid, text) from public, anon;
grant execute on function public.open_media_note_web_item_farcaster_copy(text, text, bigint, uuid, text) to authenticated;
