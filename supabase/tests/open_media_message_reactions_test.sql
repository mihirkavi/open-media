begin;

select plan(12);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ana.reactions@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ben.reactions@example.test', '', now(), now(), now()),
  ('c3000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'cat.reactions@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-000000000001', 'ana_reactions', 'Ana', ''), ('b2000000-0000-0000-0000-000000000002', 'ben_reactions', 'Ben', ''), ('c3000000-0000-0000-0000-000000000003', 'cat_reactions', 'Cat', '');
insert into public.conversations (id, kind, created_by) values ('d4000000-0000-0000-0000-000000000004', 'direct', 'a1000000-0000-0000-0000-000000000001');
insert into public.conversation_members (conversation_id, user_id)
values ('d4000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001'), ('d4000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000002');
insert into public.messages (id, conversation_id, sender_id, client_id, body, transport)
values ('e5000000-0000-0000-0000-000000000005', 'd4000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000002', gen_random_uuid(), 'Hike on Saturday?', 'open_media');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);

select is(public.open_media_set_reaction('e5000000-0000-0000-0000-000000000005', '❤️'), '❤️', 'Ana loves the message');
select is((select emoji from public.message_reactions where user_id = 'a1000000-0000-0000-0000-000000000001'), '❤️', 'and it is stored');
select is(public.open_media_set_reaction('e5000000-0000-0000-0000-000000000005', '😂'), '😂', 'choosing another emoji replaces it');
select is((select count(*)::int from public.message_reactions), 1, 'one reaction per person');
select is(public.open_media_set_reaction('e5000000-0000-0000-0000-000000000005', '😂'), null, 'choosing the same emoji takes it off');
select is((select count(*)::int from public.message_reactions), 0, 'and it is gone');
select throws_ok($$ select public.open_media_set_reaction('e5000000-0000-0000-0000-000000000005', 'hello') $$, '23514', null, 'words are not reactions');
select throws_ok($$ insert into public.message_reactions (message_id, user_id, conversation_id, emoji) values ('e5000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000004', '👍') $$, '42501', null, 'clients cannot write the table directly');

-- Ben sees Ana's reaction; a stranger sees nothing and cannot react.
select public.open_media_set_reaction('e5000000-0000-0000-0000-000000000005', '👍');
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
select is((select count(*)::int from public.message_reactions), 1, 'the other member sees the reaction');
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-000000000003', true);
select is((select count(*)::int from public.message_reactions), 0, 'a stranger sees none');
select throws_ok($$ select public.open_media_set_reaction('e5000000-0000-0000-0000-000000000005', '👍') $$, '42501', null, 'a stranger cannot react');

-- While blocked, Ana can still take her reaction off but cannot add one.
reset role;
insert into public.user_blocks (blocker_id, blocked_id) values ('b2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select throws_ok($$ select public.open_media_set_reaction('e5000000-0000-0000-0000-000000000005', '❤️') $$, '42501', null, 'no new reactions while blocked');

select * from finish();
rollback;
