begin;

select plan(9);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice@example.test', '', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bob@example.test', '', now(), now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$ select public.open_media_save_mail_account('alice@example.test', 'imap', 'imap.example.test', 993, true, 'alice', 'ciphertext', 'smtp.example.test', 587, 'starttls') $$,
  'a person can save a mailbox with outgoing SMTP settings'
);
select lives_ok(
  $$ select public.open_media_save_mail_account('alice2@example.test', 'imap', 'imap.example.test', 993, true, 'alice', 'ciphertext') $$,
  'SMTP settings are optional (receive-only mailbox)'
);
select throws_ok(
  $$ select public.open_media_save_mail_account('alice3@example.test', 'imap', 'imap.example.test', 993, true, 'alice', 'ciphertext', 'smtp.example.test', null, null) $$,
  '23514', null, 'partial SMTP settings are rejected'
);
select is(
  (select count(*) from public.open_media_list_mail_accounts() where can_send),
  1::bigint,
  'the account list reports which mailboxes can send'
);
select is(
  (select smtp_security from public.open_media_get_mail_account((select id from public.open_media_list_mail_accounts() where can_send))),
  'starttls',
  'the owner can read SMTP settings back'
);
select ok(
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'open_media_list_mail_accounts' and column_name = 'encrypted_secret'),
  'the account list never returns credentials'
);

select public.convo_save_mail_messages(
  (select id from public.open_media_list_mail_accounts() where can_send),
  '[{"sourceMessageId":"<1@x>","mailbox":"INBOX","subject":"Hi","from":"Ana <ana@example.test>","to":["alice@example.test"],"sentAt":"2026-10-01T10:00:00Z","text":"hello"},
    {"sourceMessageId":"<2@x>","mailbox":"Sent","subject":"Re: Hi","from":"alice@example.test","to":["ana@example.test"],"sentAt":"2026-10-01T11:00:00Z","text":"hey"}]'::jsonb
);
select is(
  (select array_agg(mailbox order by sent_at desc) from public.open_media_list_mail_messages()),
  array['Sent', 'INBOX'],
  'stored inbound and sent email load newest first'
);
select is(
  (select account_email from public.open_media_list_mail_messages() limit 1),
  'alice@example.test',
  'each stored email names its mailbox'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*) from public.open_media_list_mail_messages()),
  0::bigint,
  'another person cannot read the stored email'
);

select * from finish();
rollback;
