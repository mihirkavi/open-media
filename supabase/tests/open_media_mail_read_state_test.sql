begin;

select plan(8);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice@example.test', '', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bob@example.test', '', now(), now(), now());
insert into private.mail_accounts (id, user_id, email, protocol, host, port, username, encrypted_secret)
values
  ('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'alice@example.test', 'imap', 'imap.example.test', 993, 'alice', 'ciphertext'),
  ('b0000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000002', 'bob@example.test', 'imap', 'imap.example.test', 993, 'bob', 'ciphertext');
insert into private.mail_messages (user_id, account_id, source_message_id, mailbox, sent_at)
values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', '<old@x>', 'INBOX', now()),
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', '<new@x>', 'INBOX', now()),
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', '<sent@x>', 'Sent', now()),
  ('20000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', '<bob@x>', 'INBOX', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select is((select count(*)::int from public.open_media_unseen_mail()), 0, 'mail stored before read state counts as read');
select is(public.open_media_set_mail_seen('a0000000-0000-0000-0000-00000000000a', '{}', array['<new@x>', '<sent@x>']), 1, 'sync marks unread mail unread; sent mail never is');
select results_eq($$ select source_message_id from public.open_media_unseen_mail() $$, $$ values ('<new@x>'::text) $$, 'the unread message is listed');
select is(public.open_media_set_mail_seen('a0000000-0000-0000-0000-00000000000a', '{}', array['<new@x>']), 0, 'setting the same state again changes nothing');
select is(public.open_media_set_mail_seen('a0000000-0000-0000-0000-00000000000a', array['<new@x>']), 1, 'opening it marks it read');
select is((select count(*)::int from public.open_media_unseen_mail()), 0, 'nothing unread after opening');

-- Another person's mail can't be changed or seen.
select is(public.open_media_set_mail_seen('b0000000-0000-0000-0000-00000000000b', '{}', array['<bob@x>']), 0, 'Alice cannot mark Bob''s mail unread');
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select is((select count(*)::int from public.open_media_unseen_mail()), 0, 'Bob''s mail is untouched');

select * from finish();
rollback;
