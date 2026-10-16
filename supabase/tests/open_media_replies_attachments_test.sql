begin;

select plan(8);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice@example.test', '', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bob@example.test', '', now(), now(), now()),
  ('30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'carol@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name)
values
  ('10000000-0000-0000-0000-000000000001', 'alice', 'Alice'),
  ('20000000-0000-0000-0000-000000000002', 'bob', 'Bob'),
  ('30000000-0000-0000-0000-000000000003', 'carol', 'Carol');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

-- Native replies
select public.open_media_start_direct_conversation('20000000-0000-0000-0000-000000000002');
select public.open_media_start_direct_conversation('30000000-0000-0000-0000-000000000003');
insert into public.messages (conversation_id, sender_id, client_id, body)
select c.id, '10000000-0000-0000-0000-000000000001', gen_random_uuid(), 'original'
from public.conversations c join public.conversation_members m on m.conversation_id = c.id
where m.user_id = '20000000-0000-0000-0000-000000000002';
select lives_ok(
  $$ insert into public.messages (conversation_id, sender_id, client_id, body, reply_to_message_id)
     select m.conversation_id, '10000000-0000-0000-0000-000000000001', gen_random_uuid(), 'reply', m.id
     from public.messages m where m.body = 'original' $$,
  'a message can reply to a message in the same conversation'
);
select is(
  (select original.body from public.messages reply join public.messages original on original.id = reply.reply_to_message_id where reply.body = 'reply'),
  'original',
  'the reply records which message it quotes'
);
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, client_id, body, reply_to_message_id)
     select c.id, '10000000-0000-0000-0000-000000000001', gen_random_uuid(), 'cross', (select id from public.messages where body = 'original')
     from public.conversations c join public.conversation_members m on m.conversation_id = c.id
     where m.user_id = '30000000-0000-0000-0000-000000000003' $$,
  '22023', null, 'a reply cannot quote a message from another conversation'
);

-- Email attachments, images, and In-Reply-To
select public.open_media_save_mail_account('alice@example.test', 'imap', 'imap.example.test', 993, true, 'alice', 'ciphertext');
select lives_ok(
  $$ select public.open_media_save_mail_messages(
       (select id from public.open_media_list_mail_accounts() limit 1),
       jsonb_build_array(jsonb_build_object(
         'sourceMessageId', '<p@x>', 'mailbox', 'INBOX', 'subject', 'Photos', 'from', 'Ana <ana@example.test>',
         'to', jsonb_build_array('alice@example.test'), 'sentAt', '2026-10-01T10:00:00Z', 'text', 'see attached',
         'inReplyTo', '<earlier@x>',
         'remoteImages', jsonb_build_array('https://cdn.example.test/a.jpg', 'http://insecure.example.test/b.jpg'),
         'attachments', jsonb_build_array(
           jsonb_build_object('filename', 'beach.jpg', 'contentType', 'image/jpeg', 'size', 1234, 'storagePath', '10000000-0000-0000-0000-000000000001/acct/key/0-beach.jpg', 'inline', false),
           jsonb_build_object('filename', 'big.mov', 'contentType', 'video/quicktime', 'size', 99999999, 'inline', false))))
     ) $$,
  'messages save with attachments, images, and In-Reply-To'
);
select is(
  (select jsonb_array_length(attachments) from public.open_media_list_mail_messages() where source_message_id = '<p@x>'),
  2,
  'attachments are listed with their message'
);
select is(
  (select remote_images from public.open_media_list_mail_messages() where source_message_id = '<p@x>'),
  array['https://cdn.example.test/a.jpg'],
  'only HTTPS remote images are kept'
);
select is(
  (select in_reply_to from public.open_media_list_mail_messages() where source_message_id = '<p@x>'),
  '<earlier@x>',
  'In-Reply-To is kept for threading'
);
select throws_ok(
  $$ select public.open_media_save_mail_messages(
       (select id from public.open_media_list_mail_accounts() limit 1),
       jsonb_build_array(jsonb_build_object(
         'sourceMessageId', '<q@x>', 'mailbox', 'INBOX', 'subject', 'x', 'from', 'a@b.test', 'to', '[]'::jsonb, 'sentAt', '2026-10-01T10:00:00Z', 'text', 'x',
         'attachments', jsonb_build_array(jsonb_build_object('filename', 'a', 'contentType', 'image/png', 'size', 1, 'storagePath', '20000000-0000-0000-0000-000000000002/x/a.png'))))
     ) $$,
  '42501', null, 'attachment paths must be in the person''s own storage folder'
);

select * from finish();
rollback;
