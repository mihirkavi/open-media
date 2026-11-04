begin;

select plan(17);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'reader@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated', 'pest2@example.test', '', now(), now(), now()),
  ('c3000000-0000-0000-0000-0000000000f3', 'authenticated', 'authenticated', 'noprofile@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-0000000000f1', 'reader', 'Reader', ''), ('b2000000-0000-0000-0000-0000000000f2', 'pest2', 'Pest', '');
insert into public.user_blocks (blocker_id, blocked_id) values ('a1000000-0000-0000-0000-0000000000f1', 'b2000000-0000-0000-0000-0000000000f2');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f1', true);
select is(public.open_media_web_item_engagement(array['https://news.example.test/story']) -> 'https://news.example.test/story', '{"likes": 0, "liked": false, "replies": 0, "reposts": 0, "reshared": false, "farcasterCopies": {"likes": [], "comments": [], "reshares": []}}'::jsonb, 'a web item starts with zero counts');
select is((public.open_media_set_web_item_like('https://news.example.test/story', true) ->> 'likes')::int, 1, 'a person likes a web item');
select is((public.open_media_set_web_item_like('https://news.example.test/story', true) ->> 'likes')::int, 1, 'liking twice counts once');
select is((public.open_media_set_web_item_reshare('https://news.example.test/story', true) ->> 'reposts')::int, 1, 'a person reshares a web item');
select is((public.open_media_add_web_item_comment('https://news.example.test/story', 'f5000000-0000-0000-0000-0000000000f5', '  Good read  ') ->> 'body'), 'Good read', 'a person comments, trimmed');
select is((public.open_media_add_web_item_comment('https://news.example.test/story', 'f5000000-0000-0000-0000-0000000000f5', 'Good read') ->> 'body'), 'Good read', 'a retried comment returns the same comment');
select throws_ok($$ select public.open_media_set_web_item_like('http://news.example.test/story', true) $$, '22023', null, 'only https links');
-- The like and the comment were also sent to Farcaster; Open Media notes the copies.
select is(public.open_media_note_web_item_farcaster_copy('https://news.example.test/story', 'like', 4242) -> 'farcasterCopies' -> 'likes', '[4242]'::jsonb, 'a like notes its Farcaster copy');
select is(public.open_media_note_web_item_farcaster_copy('https://news.example.test/story', 'comment', 4242, (select id from public.web_item_comments where client_id = 'f5000000-0000-0000-0000-0000000000f5'), '0x' || repeat('ab', 20)) -> 'farcasterCopies' -> 'comments', jsonb_build_array('0x' || repeat('ab', 20)), 'a comment notes its cast');
select is(public.open_media_web_item_comments('https://news.example.test/story') -> 0 ->> 'farcasterHash', '0x' || repeat('ab', 20), 'comments say which cast copies them');
select throws_ok($$ select public.open_media_note_web_item_farcaster_copy('https://news.example.test/story', 'comment', 4242, gen_random_uuid(), 'not-a-hash') $$, '22023', null, 'only real cast hashes');
select throws_ok($$ insert into public.web_item_likes (item_url, user_id) values ('https://x.test/', auth.uid()) $$, '42501', null, 'likes cannot be written directly');

-- Someone the reader blocked comments; the reader never sees it.
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000f2', true);
select lives_ok($$ select public.open_media_add_web_item_comment('https://news.example.test/story', gen_random_uuid(), 'spam') $$, 'another person comments');
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f1', true);
select is(jsonb_array_length(public.open_media_web_item_comments('https://news.example.test/story')), 1, 'comments by blocked people are left out');

select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000f3', true);
select throws_ok($$ select public.open_media_set_web_item_like('https://news.example.test/story', true) $$, '42501', null, 'acting needs a profile');

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select is((public.open_media_web_item_engagement(array['https://news.example.test/story']) -> 'https://news.example.test/story' ->> 'likes')::int, 1, 'signed-out visitors see counts');
select throws_ok($$ select public.open_media_set_web_item_like('https://news.example.test/story', true) $$, '42501', null, 'but cannot like');

select * from finish();
rollback;
