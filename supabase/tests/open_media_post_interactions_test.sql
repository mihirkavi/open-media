begin;

select plan(17);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'writer@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated', 'fan@example.test', '', now(), now(), now()),
  ('c3000000-0000-0000-0000-0000000000e3', 'authenticated', 'authenticated', 'blocked@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-0000000000e1', 'writer', 'Writer', ''), ('b2000000-0000-0000-0000-0000000000e2', 'fan', 'Fan', ''), ('c3000000-0000-0000-0000-0000000000e3', 'pest', 'Pest', '');
insert into public.user_blocks (blocker_id, blocked_id) values ('a1000000-0000-0000-0000-0000000000e1', 'c3000000-0000-0000-0000-0000000000e3');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000e1', true);
select set_config('test.post', public.open_media_create_post('d4000000-0000-0000-0000-0000000000e4', 'Hello, Feed', null) ->> 'id', true);
select is(public.open_media_public_post(current_setting('test.post')::uuid) -> 'engagement', '{"likes": 0, "liked": false, "replies": 0, "reposts": 0, "reshared": false}'::jsonb, 'a new post starts with zero counts');

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000e2', true);
select is((public.open_media_set_post_like(current_setting('test.post')::uuid, true) ->> 'likes')::int, 1, 'a person likes a post');
select is((public.open_media_set_post_like(current_setting('test.post')::uuid, true) ->> 'likes')::int, 1, 'liking twice counts once');
select is((public.open_media_public_posts(5, null, null, 'writer', null) -> 0 -> 'engagement' ->> 'liked')::boolean, true, 'the feed shows the viewer their own like');
select is((public.open_media_set_post_reshare(current_setting('test.post')::uuid, true) ->> 'reposts')::int, 1, 'a person reshares a post');
select is((public.open_media_add_post_comment(current_setting('test.post')::uuid, 'e5000000-0000-0000-0000-0000000000e5', '  Nice one  ') ->> 'body'), 'Nice one', 'a person comments, trimmed');
select is((public.open_media_add_post_comment(current_setting('test.post')::uuid, 'e5000000-0000-0000-0000-0000000000e5', 'Nice one') ->> 'body'), 'Nice one', 'a retried comment returns the same comment');
select is((public.open_media_public_post(current_setting('test.post')::uuid) -> 'engagement' ->> 'replies')::int, 1, 'and is counted once');
select throws_ok($$ select public.open_media_add_post_comment(current_setting('test.post')::uuid, gen_random_uuid(), '   ') $$, '22023', null, 'empty comments are refused');
select throws_ok($$ insert into public.post_likes (post_id, user_id) values (current_setting('test.post')::uuid, auth.uid()) $$, '42501', null, 'likes cannot be written directly');
select is((public.open_media_set_post_like(current_setting('test.post')::uuid, false) ->> 'likes')::int, 0, 'a like can be withdrawn');

-- Blocked people cannot see the post, so they cannot act on it.
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000e3', true);
select throws_ok($$ select public.open_media_set_post_like(current_setting('test.post')::uuid, true) $$, 'P0002', null, 'a blocked person cannot like');
select throws_ok($$ select public.open_media_add_post_comment(current_setting('test.post')::uuid, gen_random_uuid(), 'hi') $$, 'P0002', null, 'or comment');
select is(public.open_media_post_comments(current_setting('test.post')::uuid), '[]'::jsonb, 'or read the comments');

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select is(jsonb_array_length(public.open_media_post_comments(current_setting('test.post')::uuid)), 1, 'signed-out visitors read comments on public posts');
select throws_ok($$ select public.open_media_set_post_like(current_setting('test.post')::uuid, true) $$, '42501', null, 'but cannot like');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000e2', true);
select is(jsonb_array_length(public.open_media_export_account_data() -> 'postComments'), 1, 'the account export includes comments');

select * from finish();
rollback;
