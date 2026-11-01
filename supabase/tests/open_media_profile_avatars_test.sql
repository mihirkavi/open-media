begin;

select plan(5);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a3000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'avatar-owner@example.test', '', now(), now(), now()),
  ('b4000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'avatar-other@example.test', '', now(), now(), now());

select is(
  (select public from storage.buckets where id = 'avatars'),
  true,
  'profile pictures are public, like the profile itself'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'avatars'),
  array['image/jpeg', 'image/png'],
  'only JPEG and PNG pictures are accepted'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('avatars', 'a3000000-0000-0000-0000-000000000001/1.jpg', 'a3000000-0000-0000-0000-000000000001') $$,
  'people can upload a picture into their own folder'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('avatars', 'b4000000-0000-0000-0000-000000000002/1.jpg', 'a3000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'nobody can upload into someone else''s folder'
);

select set_config('request.jwt.claim.sub', 'b4000000-0000-0000-0000-000000000002', true);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'avatars' and name like 'a3000000-0000-0000-0000-000000000001/%'),
  0,
  'other people cannot list someone''s folder (pictures are read by public URL)'
);

select * from finish();
rollback;
