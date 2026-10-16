-- Email attachments and images for the Messages inbox.
--
-- Files live in a private Storage bucket under <user id>/..., readable and
-- writable only by that person. Metadata is keyed by (account, source message)
-- so it can be saved alongside messages in one call. Remote images found in
-- HTML email are stored as URLs only and are loaded by the app on request.

insert into storage.buckets (id, name, public, file_size_limit)
values ('mail-attachments', 'mail-attachments', false, 15728640)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "People read their own mail attachments" on storage.objects;
create policy "People read their own mail attachments"
on storage.objects for select to authenticated
using (bucket_id = 'mail-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "People upload their own mail attachments" on storage.objects;
create policy "People upload their own mail attachments"
on storage.objects for insert to authenticated
with check (bucket_id = 'mail-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "People replace their own mail attachments" on storage.objects;
create policy "People replace their own mail attachments"
on storage.objects for update to authenticated
using (bucket_id = 'mail-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'mail-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "People delete their own mail attachments" on storage.objects;
create policy "People delete their own mail attachments"
on storage.objects for delete to authenticated
using (bucket_id = 'mail-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table if not exists private.mail_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references private.mail_accounts(id) on delete cascade,
  source_message_id text not null,
  position integer not null check (position between 0 and 49),
  filename text not null check (char_length(filename) between 1 and 255),
  content_type text not null check (char_length(content_type) <= 255),
  size_bytes bigint not null check (size_bytes >= 0),
  -- Null when the file was too large to store; the app then says to open the mail app.
  storage_path text check (storage_path is null or char_length(storage_path) <= 1024),
  is_inline boolean not null default false,
  created_at timestamptz not null default now(),
  unique (account_id, source_message_id, position)
);

create index if not exists mail_attachments_user_idx on private.mail_attachments (user_id);
alter table private.mail_attachments enable row level security;
revoke all on private.mail_attachments from anon, authenticated;

alter table private.mail_messages
  add column if not exists remote_images text[] not null default '{}';

create or replace function public.open_media_save_mail_messages(
  p_account_id uuid,
  p_messages jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_message jsonb;
  v_attachment jsonb;
  v_position integer;
begin
  if v_user_id is null then
    raise exception 'A valid Open Media session is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 100 then
    raise exception 'Messages must be an array of at most 100 items.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from private.mail_accounts as account
    where account.id = p_account_id and account.user_id = v_user_id
  ) then
    raise exception 'Mailbox not found.' using errcode = 'P0002';
  end if;

  insert into private.mail_messages (
    user_id, account_id, source_message_id, mailbox, subject, sender, recipients, sent_at, body_text,
    sender_verified, sender_logo_url, remote_images
  )
  select
    v_user_id,
    p_account_id,
    message ->> 'sourceMessageId',
    message ->> 'mailbox',
    coalesce(message ->> 'subject', ''),
    coalesce(message ->> 'from', ''),
    coalesce(array(select jsonb_array_elements_text(message -> 'to')), '{}'::text[]),
    (message ->> 'sentAt')::timestamptz,
    coalesce(message ->> 'text', ''),
    coalesce((message ->> 'senderVerified')::boolean, false),
    case when message ->> 'senderLogoUrl' ~ '^https://' then left(message ->> 'senderLogoUrl', 2048) end,
    coalesce(array(
      select left(url, 2048)
      from jsonb_array_elements_text(coalesce(message -> 'remoteImages', '[]'::jsonb)) with ordinality as image(url, n)
      where url ~ '^https://' and n <= 12
    ), '{}'::text[])
  from jsonb_array_elements(p_messages) as message
  on conflict (account_id, source_message_id) do update set
    subject = excluded.subject,
    sender = excluded.sender,
    recipients = excluded.recipients,
    sent_at = excluded.sent_at,
    body_text = excluded.body_text,
    sender_verified = excluded.sender_verified,
    sender_logo_url = excluded.sender_logo_url,
    remote_images = excluded.remote_images;

  -- Attachment metadata. Paths must sit in this person's own Storage folder.
  for v_message in select * from jsonb_array_elements(p_messages) loop
    if jsonb_typeof(v_message -> 'attachments') = 'array' then
      v_position := 0;
      for v_attachment in select * from jsonb_array_elements(v_message -> 'attachments') loop
        exit when v_position >= 50;
        if v_attachment ->> 'storagePath' is not null
           and split_part(v_attachment ->> 'storagePath', '/', 1) <> v_user_id::text then
          raise exception 'Attachment path is outside your storage.' using errcode = '42501';
        end if;
        insert into private.mail_attachments (user_id, account_id, source_message_id, position, filename, content_type, size_bytes, storage_path, is_inline)
        values (
          v_user_id, p_account_id, v_message ->> 'sourceMessageId', v_position,
          left(coalesce(nullif(v_attachment ->> 'filename', ''), 'attachment'), 255),
          left(coalesce(nullif(v_attachment ->> 'contentType', ''), 'application/octet-stream'), 255),
          greatest(coalesce((v_attachment ->> 'size')::bigint, 0), 0),
          v_attachment ->> 'storagePath',
          coalesce((v_attachment ->> 'inline')::boolean, false)
        )
        on conflict (account_id, source_message_id, position) do update set
          filename = excluded.filename,
          content_type = excluded.content_type,
          size_bytes = excluded.size_bytes,
          storage_path = coalesce(excluded.storage_path, private.mail_attachments.storage_path),
          is_inline = excluded.is_inline;
        v_position := v_position + 1;
      end loop;
    end if;
  end loop;
end;
$$;

-- Which messages already have their attachments stored, so sync does not re-upload them.
create or replace function public.open_media_mail_messages_with_attachments(p_account_id uuid)
returns setof text
language sql
security definer
set search_path = ''
stable
as $$
  select distinct attachment.source_message_id
  from private.mail_attachments as attachment
  where attachment.account_id = p_account_id and attachment.user_id = auth.uid();
$$;

drop function if exists public.open_media_list_mail_messages(integer);
create function public.open_media_list_mail_messages(p_limit integer default 500)
returns table (
  id uuid,
  account_id uuid,
  account_email text,
  source_message_id text,
  mailbox text,
  subject text,
  sender text,
  recipients text[],
  sent_at timestamptz,
  body_text text,
  sender_verified boolean,
  sender_logo_url text,
  remote_images text[],
  attachments jsonb
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    message.id, message.account_id, account.email, message.source_message_id, message.mailbox,
    message.subject, message.sender, message.recipients, message.sent_at, message.body_text,
    message.sender_verified, message.sender_logo_url, message.remote_images,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'filename', attachment.filename,
        'contentType', attachment.content_type,
        'size', attachment.size_bytes,
        'storagePath', attachment.storage_path,
        'inline', attachment.is_inline
      ) order by attachment.position)
      from private.mail_attachments as attachment
      where attachment.account_id = message.account_id
        and attachment.source_message_id = message.source_message_id
        and attachment.user_id = message.user_id
    ), '[]'::jsonb)
  from private.mail_messages as message
  join private.mail_accounts as account on account.id = message.account_id
  where message.user_id = auth.uid()
  order by message.sent_at desc
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

revoke all on function public.open_media_save_mail_messages(uuid, jsonb) from public, anon;
revoke all on function public.open_media_mail_messages_with_attachments(uuid) from public, anon;
revoke all on function public.open_media_list_mail_messages(integer) from public, anon;
grant execute on function public.open_media_save_mail_messages(uuid, jsonb) to authenticated;
grant execute on function public.open_media_mail_messages_with_attachments(uuid) to authenticated;
grant execute on function public.open_media_list_mail_messages(integer) to authenticated;
