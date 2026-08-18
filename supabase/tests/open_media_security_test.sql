begin;

select plan(36);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice@example.test', '', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bob@example.test', '', now(), now(), now()),
  ('30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'mallory@example.test', '', now(), now(), now());

insert into public.profiles (id, handle, display_name)
values
  ('10000000-0000-0000-0000-000000000001', 'alice', 'Alice'),
  ('20000000-0000-0000-0000-000000000002', 'bob', 'Bob'),
  ('30000000-0000-0000-0000-000000000003', 'mallory', 'Mallory');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$ select public.open_media_start_direct_conversation('20000000-0000-0000-0000-000000000002') $$,
  'an authenticated profile can start a direct conversation'
);

select is(
  public.open_media_start_direct_conversation('20000000-0000-0000-0000-000000000002'),
  public.open_media_start_direct_conversation('20000000-0000-0000-0000-000000000002'),
  'repeated direct-conversation requests are idempotent'
);

select is((select count(*) from public.conversations), 1::bigint, 'a member sees the direct conversation');
select is((select count(*) from public.conversation_members), 2::bigint, 'a member sees both direct participants');

select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, client_id, body)
     select id, '20000000-0000-0000-0000-000000000002', gen_random_uuid(), 'forged'
     from public.conversations limit 1 $$,
  '42501',
  null,
  'RLS rejects a forged sender ID'
);

select lives_ok(
  $$ insert into public.messages (conversation_id, sender_id, client_id, body, created_at)
     select id, '10000000-0000-0000-0000-000000000001', gen_random_uuid(), 'hello', now() + interval '1 second'
     from public.conversations limit 1 $$,
  'a member can send as themself'
);

select ok(
  (select updated_at > created_at from public.conversations limit 1),
  'sending a message advances conversation ordering'
);

select is((select transport from public.messages where body = 'hello'), 'open_media', 'the database prevents transport provenance spoofing');
select ok((select created_at <= clock_timestamp() from public.messages where body = 'hello'), 'the database prevents message timestamp backdating');

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true);
select is((select count(*) from public.conversations), 0::bigint, 'a non-member cannot read the conversation');
select is((select count(*) from public.messages), 0::bigint, 'a non-member cannot read messages');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$ insert into public.messages (conversation_id, sender_id, client_id, body)
     select id, '20000000-0000-0000-0000-000000000002', gen_random_uuid(), 'reported message'
     from public.conversations limit 1 $$,
  'the other direct participant can send before a block'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$ select public.open_media_set_user_blocked('20000000-0000-0000-0000-000000000002', true) $$,
  'a user can block another profile'
);
select is((select count(*) from public.user_blocks), 1::bigint, 'a user can read their own block');
select throws_ok(
  $$ select public.open_media_start_direct_conversation('20000000-0000-0000-0000-000000000002') $$,
  '42501',
  'This conversation is blocked.',
  'a blocked pair cannot start or reopen a direct conversation'
);
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, client_id, body)
     select id, '10000000-0000-0000-0000-000000000001', gen_random_uuid(), 'blocked outbound'
     from public.conversations limit 1 $$,
  '42501',
  'This conversation is blocked.',
  'the blocker cannot send into the blocked direct conversation'
);
select lives_ok(
  $$ select public.open_media_report_conversation(
       '20000000-0000-0000-0000-000000000002',
       (select id from public.conversations limit 1),
       (select id from public.messages where body = 'reported message')
     ) $$,
  'a member can report an inbound message'
);
select is((select count(*) from public.abuse_reports), 1::bigint, 'a reporter can read their own report');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, client_id, body)
     select id, '20000000-0000-0000-0000-000000000002', gen_random_uuid(), 'blocked inbound'
     from public.conversations limit 1 $$,
  '42501',
  'This conversation is blocked.',
  'the blocked person cannot send into the direct conversation'
);
select is((select count(*) from public.abuse_reports), 0::bigint, 'the reported user cannot read the report');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$ select public.open_media_set_user_blocked('20000000-0000-0000-0000-000000000002', false) $$,
  'a block can be reversed'
);
select lives_ok(
  $$ insert into public.messages (conversation_id, sender_id, client_id, body)
     select id, '10000000-0000-0000-0000-000000000001', gen_random_uuid(), 'after unblock'
     from public.conversations limit 1 $$,
  'messaging resumes after unblock'
);

reset role;

insert into public.conversations (id, kind, title, created_by)
values ('40000000-0000-0000-0000-000000000004', 'group', 'Test group', '10000000-0000-0000-0000-000000000001');
insert into public.conversation_members (conversation_id, user_id, role)
values
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'owner'),
  ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', 'member');
insert into public.messages (conversation_id, sender_id, client_id, body)
values
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', gen_random_uuid(), 'alice group message'),
  ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', gen_random_uuid(), 'bob group message');
insert into private.mail_accounts (id, user_id, email, protocol, host, port, secure, username, encrypted_secret)
values
  ('11000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'alice@example.test', 'imap', 'imap.example.test', 993, true, 'alice', 'encrypted-test-value'),
  ('22000000-0000-0000-0000-000000000022', '20000000-0000-0000-0000-000000000002', 'bob@example.test', 'imap', 'imap.example.test', 993, true, 'bob', 'encrypted-test-value');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.open_media_list_mail_accounts()), 1::bigint, 'mailbox listing never exposes another user account');
select is(public.open_media_delete_mail_account('22000000-0000-0000-0000-000000000022'), false, 'a user cannot disconnect another user mailbox');
select is(public.open_media_delete_mail_account('11000000-0000-0000-0000-000000000011'), true, 'a user can disconnect their own mailbox');
select lives_ok(
  $$ select public.convo_save_mail_account('alice@example.test', 'imap', 'imap.example.test', 993, true, 'alice', 'encrypted-test-value') $$,
  'a mailbox can be reconnected before account deletion'
);
select ok(public.open_media_export_account_data() ?& array['profile', 'conversations', 'messages', 'mailAccounts', 'mailMessages'], 'account export includes each user-data category');
select is((public.open_media_export_account_data() -> 'mailAccounts' -> 0) ? 'encrypted_secret', false, 'account export excludes encrypted mailbox credentials');
select lives_ok(
  $$ do $block$
     declare v_remaining integer;
     begin
       select 60 - count(*) into v_remaining
       from public.messages
       where sender_id = '10000000-0000-0000-0000-000000000001'
         and created_at >= clock_timestamp() - interval '1 minute';
       for i in 1..v_remaining loop
         insert into public.messages (conversation_id, sender_id, client_id, body)
         values ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', gen_random_uuid(), 'rate-limit-fixture');
       end loop;
     end
     $block$ $$,
  'messages are accepted up to the documented per-minute limit'
);
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, client_id, body)
     values ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', gen_random_uuid(), 'one-too-many') $$,
  'P0001',
  'You are sending too quickly. Wait a minute and try again.',
  'the database rejects message flooding beyond the per-minute limit'
);
select lives_ok($$ select public.open_media_delete_account() $$, 'a signed-in user can delete their account');
reset role;

select is((select count(*) from auth.users where id = '10000000-0000-0000-0000-000000000001'), 0::bigint, 'account deletion removes the auth user');
select is((select count(*) from private.mail_accounts where user_id = '10000000-0000-0000-0000-000000000001'), 0::bigint, 'account deletion removes private mailbox credentials');
select is((
  select count(*)
  from public.conversations conversation
  where conversation.kind = 'direct'
    and exists (
      select 1 from public.conversation_members member
      where member.conversation_id = conversation.id
        and member.user_id = '20000000-0000-0000-0000-000000000002'
    )
), 0::bigint, 'account deletion removes the deleted account direct conversation');
select is((select count(*) from public.messages where sender_id = '10000000-0000-0000-0000-000000000001'), 0::bigint, 'account deletion removes authored group messages');
select is((select created_by from public.conversations where id = '40000000-0000-0000-0000-000000000004'), null::uuid, 'shared groups survive with a cleared creator reference');

select * from finish();
rollback;
