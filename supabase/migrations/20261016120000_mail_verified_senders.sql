-- Verified senders (BIMI) for the Messages inbox. Additive: the deployed
-- convo_save_mail_messages keeps working; new Workers use the open_media_ version.

alter table private.mail_messages
  add column if not exists sender_verified boolean not null default false,
  add column if not exists sender_logo_url text check (sender_logo_url is null or (sender_logo_url ~ '^https://' and char_length(sender_logo_url) <= 2048));

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
    sender_verified, sender_logo_url
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
    case when message ->> 'senderLogoUrl' ~ '^https://' then left(message ->> 'senderLogoUrl', 2048) end
  from jsonb_array_elements(p_messages) as message
  on conflict (account_id, source_message_id) do update set
    subject = excluded.subject,
    sender = excluded.sender,
    recipients = excluded.recipients,
    sent_at = excluded.sent_at,
    body_text = excluded.body_text,
    sender_verified = excluded.sender_verified,
    sender_logo_url = excluded.sender_logo_url;
end;
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
  sender_logo_url text
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    message.id, message.account_id, account.email, message.source_message_id, message.mailbox,
    message.subject, message.sender, message.recipients, message.sent_at, message.body_text,
    message.sender_verified, message.sender_logo_url
  from private.mail_messages as message
  join private.mail_accounts as account on account.id = message.account_id
  where message.user_id = auth.uid()
  order by message.sent_at desc
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

revoke all on function public.open_media_save_mail_messages(uuid, jsonb) from public, anon;
revoke all on function public.open_media_list_mail_messages(integer) from public, anon;
grant execute on function public.open_media_save_mail_messages(uuid, jsonb) to authenticated;
grant execute on function public.open_media_list_mail_messages(integer) to authenticated;
