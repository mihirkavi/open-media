create or replace function public.convo_save_mail_account(
  p_email text,
  p_protocol text,
  p_host text,
  p_port integer,
  p_secure boolean,
  p_username text,
  p_encrypted_secret text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_account_id uuid;
begin
  if v_user_id is null then
    raise exception 'A valid Convo session is required.' using errcode = '42501';
  end if;

  insert into private.mail_accounts (
    user_id, email, protocol, host, port, secure, username, encrypted_secret, status
  ) values (
    v_user_id, p_email, p_protocol, p_host, p_port, p_secure, p_username, p_encrypted_secret, 'connected'
  )
  returning id into v_account_id;

  return v_account_id;
end;
$$;

create or replace function public.convo_get_mail_account(p_account_id uuid)
returns table (
  id uuid,
  user_id uuid,
  email text,
  protocol text,
  host text,
  port integer,
  secure boolean,
  username text,
  encrypted_secret text,
  status text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'A valid Convo session is required.' using errcode = '42501';
  end if;

  return query
  select
    account.id,
    account.user_id,
    account.email,
    account.protocol,
    account.host,
    account.port,
    account.secure,
    account.username,
    account.encrypted_secret,
    account.status
  from private.mail_accounts as account
  where account.id = p_account_id
    and account.user_id = v_user_id;
end;
$$;

create or replace function public.convo_save_mail_messages(
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
    raise exception 'A valid Convo session is required.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 100 then
    raise exception 'Messages must be an array of at most 100 items.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.mail_accounts as account
    where account.id = p_account_id
      and account.user_id = v_user_id
  ) then
    raise exception 'Mailbox not found.' using errcode = 'P0002';
  end if;

  insert into private.mail_messages (
    user_id,
    account_id,
    source_message_id,
    mailbox,
    subject,
    sender,
    recipients,
    sent_at,
    body_text
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
    coalesce(message ->> 'text', '')
  from jsonb_array_elements(p_messages) as message
  on conflict (account_id, source_message_id) do update set
    subject = excluded.subject,
    sender = excluded.sender,
    recipients = excluded.recipients,
    sent_at = excluded.sent_at,
    body_text = excluded.body_text;
end;
$$;

revoke all on function public.convo_save_mail_account(text, text, text, integer, boolean, text, text) from public, anon;
revoke all on function public.convo_get_mail_account(uuid) from public, anon;
revoke all on function public.convo_save_mail_messages(uuid, jsonb) from public, anon;

grant execute on function public.convo_save_mail_account(text, text, text, integer, boolean, text, text) to authenticated;
grant execute on function public.convo_get_mail_account(uuid) to authenticated;
grant execute on function public.convo_save_mail_messages(uuid, jsonb) to authenticated;

comment on function public.convo_save_mail_account(text, text, text, integer, boolean, text, text)
  is 'Stores an encrypted mailbox credential for the authenticated Convo user.';
comment on function public.convo_get_mail_account(uuid)
  is 'Returns one mailbox only when it belongs to the authenticated Convo user.';
comment on function public.convo_save_mail_messages(uuid, jsonb)
  is 'Upserts at most 100 normalized messages into a mailbox owned by the authenticated Convo user.';
