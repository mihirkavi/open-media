-- Short videos on Open Media posts (ADR 0009).
--
-- A post may carry one short video (at most 3 minutes). The file is uploaded
-- by its author to the public `post-videos` Storage bucket under
-- <author id>/<uuid>.<ext>, with location and device metadata already removed
-- on the author's device. Posts stay public: the video is readable by anyone
-- through its public URL, exactly like the post text. The post row records the
-- Storage path (not a URL), so the hosting provider can change later without
-- rewriting posts, plus a SHA-256 of the uploaded bytes for provenance.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-videos', 'post-videos', true, 104857600, array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public bucket: anyone can download by URL. Only the author can write, and
-- only inside their own folder.
drop policy if exists "Authors read their own post videos" on storage.objects;
create policy "Authors read their own post videos"
on storage.objects for select to authenticated
using (bucket_id = 'post-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Authors upload their own post videos" on storage.objects;
create policy "Authors upload their own post videos"
on storage.objects for insert to authenticated
with check (bucket_id = 'post-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Authors delete their own post videos" on storage.objects;
create policy "Authors delete their own post videos"
on storage.objects for delete to authenticated
using (bucket_id = 'post-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter table public.posts
  add column if not exists video_path text,
  add column if not exists video_poster_path text,
  add column if not exists video_duration_seconds numeric(6, 2),
  add column if not exists video_width integer,
  add column if not exists video_height integer,
  add column if not exists video_content_type text,
  add column if not exists video_sha256 text;

-- Replacing a file is allowed only before a post uses it (an upload retry). Once published, a
-- post's video can be deleted but never swapped for different content.
create or replace function app_private.post_video_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.posts where video_path = p_name or video_poster_path = p_name); $$;

revoke all on function app_private.post_video_in_use(text) from public, anon;
grant execute on function app_private.post_video_in_use(text) to authenticated;

drop policy if exists "Authors replace their own post videos" on storage.objects;
create policy "Authors replace their own post videos"
on storage.objects for update to authenticated
using (bucket_id = 'post-videos' and (storage.foldername(name))[1] = (select auth.uid())::text and not app_private.post_video_in_use(name))
with check (bucket_id = 'post-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- A video post may have no text; a text post still needs some.
alter table public.posts drop constraint if exists posts_body_check;
alter table public.posts add constraint posts_body_check
  check (char_length(btrim(body)) <= 2000 and (char_length(btrim(body)) >= 1 or video_path is not null));

alter table public.posts drop constraint if exists posts_video_check;
alter table public.posts add constraint posts_video_check check (
  video_path is null
  or (
    video_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|mov|webm)$'
    and (video_poster_path is null or video_poster_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$')
    and video_duration_seconds > 0 and video_duration_seconds <= 180
    and video_width between 1 and 8192
    and video_height between 1 and 8192
    and video_content_type in ('video/mp4', 'video/quicktime', 'video/webm')
    and video_sha256 ~ '^[0-9a-f]{64}$'
  )
);

create unique index if not exists posts_video_path_idx on public.posts (video_path) where video_path is not null;
create index if not exists posts_public_video_order_idx
  on public.posts (created_at desc, id desc)
  where removed_at is null and video_path is not null;

create or replace function app_private.public_post_json(p_post public.posts, p_profile public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_post.id,
    'body', p_post.body,
    'createdAt', p_post.created_at,
    'author', jsonb_build_object(
      'id', p_profile.id,
      'handle', p_profile.handle,
      'displayName', p_profile.display_name,
      'avatarUrl', p_profile.avatar_url
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

-- Listing gains an optional media filter so Clips can page through video posts only.
drop function if exists public.open_media_public_posts(integer, timestamptz, uuid, text);
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
      and (
        auth.uid() is null
        or not app_private.users_are_blocked(auth.uid(), post.author_id)
      )
    order by post.created_at desc, post.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) item;
$$;

revoke all on function public.open_media_public_posts(integer, timestamptz, uuid, text, text) from public;
grant execute on function public.open_media_public_posts(integer, timestamptz, uuid, text, text) to anon, authenticated;
comment on function public.open_media_public_posts(integer, timestamptz, uuid, text, text) is 'Public, anonymous-safe post listing with keyset pagination (max 50). p_media = ''video'' returns only video posts.';

drop function if exists public.open_media_create_post(uuid, text);
drop function if exists app_private.create_post(uuid, text);

create or replace function app_private.create_post(p_client_id uuid, p_body text, p_video jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_post public.posts;
  v_profile public.profiles;
  v_video_path text;
  v_poster_path text;
begin
  if v_user_id is null then
    raise exception 'A valid Open Media session is required.' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_user_id;
  if v_profile.id is null then
    raise exception 'Create your Open Media profile before posting.' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'A post client ID is required.' using errcode = '22023';
  end if;
  if p_video is not null and jsonb_typeof(p_video) <> 'object' then
    raise exception 'The video details are invalid.' using errcode = '22023';
  end if;
  if char_length(v_body) > 2000 or (char_length(v_body) = 0 and p_video is null) then
    raise exception 'Posts must be between 1 and 2000 characters.' using errcode = '22023';
  end if;

  select * into v_post from public.posts where author_id = v_user_id and client_id = p_client_id;
  if v_post.id is not null then
    return app_private.public_post_json(v_post, v_profile);
  end if;

  if p_video is not null then
    v_video_path := p_video ->> 'path';
    v_poster_path := nullif(p_video ->> 'posterPath', '');
    -- The file must already be uploaded, by this author, into their own folder.
    if v_video_path is null or split_part(v_video_path, '/', 1) <> v_user_id::text
       or not exists (
         select 1 from storage.objects object
         where object.bucket_id = 'post-videos' and object.name = v_video_path and object.owner_id = v_user_id::text
       ) then
      raise exception 'Upload the video before publishing.' using errcode = '22023';
    end if;
    if v_poster_path is not null and (
      split_part(v_poster_path, '/', 1) <> v_user_id::text
      or not exists (
        select 1 from storage.objects object
        where object.bucket_id = 'post-videos' and object.name = v_poster_path and object.owner_id = v_user_id::text
      )
    ) then
      v_poster_path := null;
    end if;
    if exists (select 1 from public.posts where video_path = v_video_path) then
      raise exception 'That video is already attached to a post.' using errcode = '22023';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 3));
  if (select count(*) from public.posts where author_id = v_user_id and created_at >= pg_catalog.clock_timestamp() - interval '1 hour') >= 30 then
    raise exception 'You are posting too quickly. Wait a while and try again.' using errcode = 'P0001';
  end if;

  begin
    insert into public.posts (
      author_id, client_id, body,
      video_path, video_poster_path, video_duration_seconds, video_width, video_height, video_content_type, video_sha256
    )
    values (
      v_user_id, p_client_id, v_body,
      v_video_path,
      v_poster_path,
      case when p_video is null then null else round((p_video ->> 'durationSeconds')::numeric, 2) end,
      case when p_video is null then null else (p_video ->> 'width')::integer end,
      case when p_video is null then null else (p_video ->> 'height')::integer end,
      p_video ->> 'contentType',
      lower(p_video ->> 'sha256')
    )
    returning * into v_post;
  exception
    when check_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'The video must be an MP4, MOV, or WebM file of at most 3 minutes.' using errcode = '22023';
  end;
  return app_private.public_post_json(v_post, v_profile);
end;
$$;

revoke all on function app_private.create_post(uuid, text, jsonb) from public, anon;
grant execute on function app_private.create_post(uuid, text, jsonb) to authenticated;

create or replace function public.open_media_create_post(p_client_id uuid, p_body text, p_video jsonb default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select app_private.create_post(p_client_id, p_body, p_video); $$;

revoke all on function public.open_media_create_post(uuid, text, jsonb) from public, anon;
grant execute on function public.open_media_create_post(uuid, text, jsonb) to authenticated;

comment on column public.posts.video_path is 'Path in the public post-videos Storage bucket (<author id>/<uuid>.<ext>). Location and device metadata are removed before upload.';
comment on column public.posts.video_sha256 is 'SHA-256 (hex) of the uploaded video bytes, for provenance and integrity checks.';
