begin;

select plan(16);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('11000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'vera@example.test', '', now(), now(), now()),
  ('22000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'otto@example.test', '', now(), now(), now());

insert into public.profiles (id, handle, display_name, bio)
values
  ('11000000-0000-0000-0000-000000000001', 'vera', 'Vera', ''),
  ('22000000-0000-0000-0000-000000000002', 'otto', 'Otto', '');

-- Stand-ins for files uploaded through the Storage API by each author.
insert into storage.objects (bucket_id, name, owner_id)
values
  ('post-videos', '11000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-000000000001.mp4', '11000000-0000-0000-0000-000000000001'),
  ('post-videos', '11000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-000000000001.jpg', '11000000-0000-0000-0000-000000000001'),
  ('post-videos', '11000000-0000-0000-0000-000000000001/b2000000-0000-0000-0000-000000000002.mp4', '11000000-0000-0000-0000-000000000001'),
  ('post-videos', '22000000-0000-0000-0000-000000000002/c1000000-0000-0000-0000-000000000001.mp4', '22000000-0000-0000-0000-000000000002');

select is((select public from storage.buckets where id = 'post-videos'), true, 'post videos are public, like posts');
select is((select file_size_limit from storage.buckets where id = 'post-videos'), 104857600::bigint, 'post videos are limited to 100 MB');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$ select public.open_media_create_post('b1000000-0000-0000-0000-000000000001', '', jsonb_build_object(
    'path', '11000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-000000000001.mp4',
    'posterPath', '11000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-000000000001.jpg',
    'durationSeconds', 42.123, 'width', 720, 'height', 1280, 'contentType', 'video/mp4', 'sha256', repeat('ab', 32))) $$,
  'a video post may have no text'
);
select is(
  (select video_duration_seconds from public.posts where client_id = 'b1000000-0000-0000-0000-000000000001'),
  42.12::numeric(6, 2),
  'the video duration is stored'
);
select throws_ok(
  $$ select public.open_media_create_post(gen_random_uuid(), 'stolen', jsonb_build_object(
    'path', '22000000-0000-0000-0000-000000000002/c1000000-0000-0000-0000-000000000001.mp4',
    'durationSeconds', 10, 'width', 720, 'height', 1280, 'contentType', 'video/mp4', 'sha256', repeat('ab', 32))) $$,
  '22023', 'Upload the video before publishing.', 'authors cannot attach someone else''s video'
);
select throws_ok(
  $$ select public.open_media_create_post(gen_random_uuid(), 'not uploaded', jsonb_build_object(
    'path', '11000000-0000-0000-0000-000000000001/d1000000-0000-0000-0000-000000000009.mp4',
    'durationSeconds', 10, 'width', 720, 'height', 1280, 'contentType', 'video/mp4', 'sha256', repeat('ab', 32))) $$,
  '22023', 'Upload the video before publishing.', 'the file must exist in storage'
);
select throws_ok(
  $$ select public.open_media_create_post(gen_random_uuid(), 'too long', jsonb_build_object(
    'path', '11000000-0000-0000-0000-000000000001/b2000000-0000-0000-0000-000000000002.mp4',
    'durationSeconds', 181, 'width', 720, 'height', 1280, 'contentType', 'video/mp4', 'sha256', repeat('ab', 32))) $$,
  '22023', null, 'videos longer than 3 minutes are rejected'
);
select throws_ok(
  $$ select public.open_media_create_post(gen_random_uuid(), 'bad type', jsonb_build_object(
    'path', '11000000-0000-0000-0000-000000000001/b2000000-0000-0000-0000-000000000002.mp4',
    'durationSeconds', 10, 'width', 720, 'height', 1280, 'contentType', 'video/x-msvideo', 'sha256', repeat('ab', 32))) $$,
  '22023', null, 'only MP4, MOV, and WebM are accepted'
);
select throws_ok(
  $$ select public.open_media_create_post(gen_random_uuid(), 'reuse', jsonb_build_object(
    'path', '11000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-000000000001.mp4',
    'durationSeconds', 10, 'width', 720, 'height', 1280, 'contentType', 'video/mp4', 'sha256', repeat('ab', 32))) $$,
  '22023', 'That video is already attached to a post.', 'one video belongs to one post'
);
select throws_ok(
  $$ select public.open_media_create_post(gen_random_uuid(), '   ') $$,
  '22023', null, 'text posts still need text'
);
select public.open_media_create_post(gen_random_uuid(), 'Just text');

-- Files are immutable once a post uses them; unpublished uploads can still be replaced (retries).
update storage.objects set metadata = '{"swapped": true}'::jsonb
where bucket_id = 'post-videos' and name = '11000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-000000000001.mp4';
update storage.objects set metadata = '{"retry": true}'::jsonb
where bucket_id = 'post-videos' and name = '11000000-0000-0000-0000-000000000001/b2000000-0000-0000-0000-000000000002.mp4';
select is(
  (select metadata->>'swapped' from storage.objects where bucket_id = 'post-videos' and name = '11000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-000000000001.mp4'),
  null, 'a published video cannot be replaced'
);
select is(
  (select metadata->>'retry' from storage.objects where bucket_id = 'post-videos' and name = '11000000-0000-0000-0000-000000000001/b2000000-0000-0000-0000-000000000002.mp4'),
  'true', 'an upload not yet used by a post can be replaced'
);

-- Public reading
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select is(
  jsonb_array_length(public.open_media_public_posts(20, null, null, 'vera')), 2, 'text and video posts are listed together'
);
select is(
  jsonb_array_length(public.open_media_public_posts(20, null, null, 'vera', 'video')), 1, 'media = video lists only video posts'
);
select is(
  public.open_media_public_posts(20, null, null, 'vera', 'video')->0->'video'->>'posterPath',
  '11000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-000000000001.jpg',
  'anyone can read the video and poster paths'
);
select is(
  (select item->'video' from jsonb_array_elements(public.open_media_public_posts(20, null, null, 'vera')) item where item->>'body' = 'Just text'),
  'null'::jsonb, 'text posts have a null video'
);

select * from finish();
rollback;
