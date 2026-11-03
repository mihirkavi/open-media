begin;

select plan(14);

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

-- Nobody reads the tables directly; only the functions.
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select throws_ok($$ select * from public.conversation_reads $$, '42501', null, 'read times are not a readable table');
select throws_ok($$ select * from public.message_settings $$, '42501', null, 'settings are not a readable table');

-- Ben's app fetches the conversation: delivered, not read.
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
select lives_ok($$ select public.open_media_mark_delivered() $$, 'fetching marks delivered');
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select isnt((select delivered_at from public.open_media_conversation_receipts(array['d4000000-0000-0000-0000-000000000004']::uuid[]) where user_id = 'b2000000-0000-0000-0000-000000000002'), null, 'Ana sees that it was delivered to Ben');
select is((select read_at from public.open_media_conversation_receipts(array['d4000000-0000-0000-0000-000000000004']::uuid[]) where user_id = 'b2000000-0000-0000-0000-000000000002'), null, 'but not read yet');

-- Ben opens it.
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
select isnt(public.open_media_mark_read('d4000000-0000-0000-0000-000000000004'), null, 'opening marks read');
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select isnt((select read_at from public.open_media_conversation_receipts(array['d4000000-0000-0000-0000-000000000004']::uuid[]) where user_id = 'b2000000-0000-0000-0000-000000000002'), null, 'Ana sees that Ben read it');

-- Ben turns read receipts off: Ana no longer sees his read time; delivery still shows.
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
select is(public.open_media_set_read_receipts(false) ->> 'shareReadReceipts', 'false', 'Ben turns read receipts off');
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select is((select read_at from public.open_media_conversation_receipts(array['d4000000-0000-0000-0000-000000000004']::uuid[]) where user_id = 'b2000000-0000-0000-0000-000000000002'), null, 'Ana no longer sees when Ben reads');
select isnt((select delivered_at from public.open_media_conversation_receipts(array['d4000000-0000-0000-0000-000000000004']::uuid[]) where user_id = 'b2000000-0000-0000-0000-000000000002'), null, 'delivery is still shown');

-- Reciprocal: with his off, Ben doesn't see Ana's either, but always sees his own.
select public.open_media_mark_read('d4000000-0000-0000-0000-000000000004');
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
select is((select read_at from public.open_media_conversation_receipts(array['d4000000-0000-0000-0000-000000000004']::uuid[]) where user_id = 'a1000000-0000-0000-0000-000000000001'), null, 'Ben does not see Ana''s read time while his are off');
select isnt((select read_at from public.open_media_conversation_receipts(array['d4000000-0000-0000-0000-000000000004']::uuid[]) where user_id = 'b2000000-0000-0000-0000-000000000002'), null, 'Ben still sees his own, for unread counts');

-- A stranger gets nothing and can't mark the conversation read.
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-000000000003', true);
select is((select count(*)::int from public.open_media_conversation_receipts(array['d4000000-0000-0000-0000-000000000004']::uuid[])), 0, 'a non-member sees no receipts');
select throws_ok($$ select public.open_media_mark_read('d4000000-0000-0000-0000-000000000004') $$, '42501', null, 'a non-member cannot mark it read');

select * from finish();
rollback;
