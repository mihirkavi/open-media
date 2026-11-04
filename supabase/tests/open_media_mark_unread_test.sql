begin;

select plan(9);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ben@example.test', '', now(), now(), now()),
  ('c3000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'cat@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-000000000001', 'ana', 'Ana', ''), ('b2000000-0000-0000-0000-000000000002', 'ben', 'Ben', ''), ('c3000000-0000-0000-0000-000000000003', 'cat', 'Cat', '');
insert into public.conversations (id, kind, created_by) values ('d4000000-0000-0000-0000-000000000004', 'direct', 'a1000000-0000-0000-0000-000000000001');
insert into public.conversation_members (conversation_id, user_id)
values ('d4000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001'), ('d4000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000002');

set local role authenticated;

-- Ben reads the conversation, then marks it unread.
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
select public.open_media_mark_read('d4000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.open_media_marked_unread()), 0, 'nothing is marked unread at first');
select lives_ok($$ select public.open_media_mark_unread('d4000000-0000-0000-0000-000000000004') $$, 'Ben marks it unread');
select is((select array_agg(id) from public.open_media_marked_unread() as id), array['d4000000-0000-0000-0000-000000000004']::uuid[], 'it is listed as marked unread for Ben');

-- His read receipt stays: Ana still sees that he read it.
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select isnt((select read_at from public.open_media_conversation_receipts(array['d4000000-0000-0000-0000-000000000004']::uuid[]) where user_id = 'b2000000-0000-0000-0000-000000000002'), null, 'marking unread does not take back the read receipt');
select is((select count(*)::int from public.open_media_marked_unread()), 0, 'Ana does not see Ben''s marks');

-- Opening it again clears the mark.
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
select public.open_media_mark_read('d4000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.open_media_marked_unread()), 0, 'opening it clears the mark');

-- Marking unread before ever opening it works too.
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select lives_ok($$ select public.open_media_mark_unread('d4000000-0000-0000-0000-000000000004') $$, 'Ana marks it unread');
select is((select count(*)::int from public.open_media_marked_unread()), 1, 'and it is listed');

-- A stranger can't.
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-000000000003', true);
select throws_ok($$ select public.open_media_mark_unread('d4000000-0000-0000-0000-000000000004') $$, '42501', null, 'a non-member cannot mark it unread');

select * from finish();
rollback;
