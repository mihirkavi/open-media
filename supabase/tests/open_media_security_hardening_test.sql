begin;

select plan(9);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'snoop@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated', 'private@example.test', '', now(), now(), now()),
  ('c3000000-0000-0000-0000-0000000000f3', 'authenticated', 'authenticated', 'friend@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-0000000000f1', 'snoop', 'Snoop', ''),
       ('b2000000-0000-0000-0000-0000000000f2', 'quietperson', 'Real Secret Name', 'private bio'),
       ('c3000000-0000-0000-0000-0000000000f3', 'friend', 'Friend', '');
update public.profiles set visibility = 'private' where id = 'b2000000-0000-0000-0000-0000000000f2';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f1', true);
select set_config('test.dm', public.open_media_start_direct_conversation('b2000000-0000-0000-0000-0000000000f2')::text, true);
select is((select count(*)::int from public.profiles where id = 'b2000000-0000-0000-0000-0000000000f2'), 0, 'opening a DM does not reveal a private profile');

reset role;
-- The private person replies: now the conversation partner may see who they are.
insert into public.messages (conversation_id, sender_id, client_id, body) values (current_setting('test.dm')::uuid, 'b2000000-0000-0000-0000-0000000000f2', gen_random_uuid(), 'hi');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f1', true);
select is((select display_name from public.profiles where id = 'b2000000-0000-0000-0000-0000000000f2'), 'Real Secret Name', 'after they write, their profile is visible to the person they wrote to');

reset role;
update public.profiles set name_disclosure = 'handle_only' where id = 'b2000000-0000-0000-0000-0000000000f2';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f1', true);
select is((select count(*)::int from public.profiles where id = 'b2000000-0000-0000-0000-0000000000f2'), 0, 'a handle-only name never leaks through a conversation');

select set_config('test.msg', (select id::text from public.messages where sender_id = 'b2000000-0000-0000-0000-0000000000f2' limit 1), true);
select public.open_media_start_direct_conversation('c3000000-0000-0000-0000-0000000000f3');
insert into public.messages (conversation_id, sender_id, client_id, body)
  select c.conversation_id, 'a1000000-0000-0000-0000-0000000000f1', gen_random_uuid(), 'hello friend'
  from public.conversation_members c join public.conversation_members o on o.conversation_id = c.conversation_id
  where c.user_id = 'a1000000-0000-0000-0000-0000000000f1' and o.user_id = 'c3000000-0000-0000-0000-0000000000f3' limit 1;
select throws_ok($$ update public.messages set conversation_id = current_setting('test.dm')::uuid, created_at = '2000-01-01' where sender_id = 'a1000000-0000-0000-0000-0000000000f1' $$, '42501', null, 'senders cannot move, backdate or relabel sent messages');
select throws_ok($$ update public.profiles set created_at = '2000-01-01' where id = 'a1000000-0000-0000-0000-0000000000f1' $$, '42501', null, 'profile timestamps are not client-writable');
select lives_ok($$ update public.profiles set bio = 'new bio', visibility = 'public' where id = 'a1000000-0000-0000-0000-0000000000f1' $$, 'people still edit their own profile');
select throws_ok($$ insert into public.conversations (kind) values ('direct') $$, '42501', null, 'conversations are created only through the function');
select is((select count(*)::int from information_schema.role_table_grants where grantee in ('anon', 'authenticated') and table_schema = 'public' and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')), 0, 'no TRUNCATE, TRIGGER or REFERENCES grants remain');
select ok(exists (select 1 from public.profiles where id = 'c3000000-0000-0000-0000-0000000000f3'), 'public profiles stay readable');

select * from finish();
rollback;
