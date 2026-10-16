-- Outgoing mail (SMTP) settings per mailbox, plus reading stored email into
-- Messages. Additive: the convo_* functions used by already-deployed Workers
-- keep working; new Workers use the open_media_* versions below.

alter table private.mail_accounts
  add column if not exists smtp_host text check (smtp_host is null or smtp_host ~ '^[A-Za-z0-9.-]{1,253}$'),
  add column if not exists smtp_port integer check (smtp_port is null or smtp_port between 1 and 65535),
  add column if not exists smtp_security text check (smtp_security is null or smtp_security in ('tls', 'starttls'));

alter table private.mail_accounts
  drop constraint if exists mail_accounts_smtp_complete;
alter table private.mail_accounts
  add constraint mail_accounts_smtp_complete check (
    (smtp_host is null and smtp_port is null and smtp_security is null)
    or (smtp_host is not null and smtp_port is not null and smtp_security is not null)
  );

create or replace function public.open_media_save_mail_account(
  p_email text,
  p_protocol text,
  p_host text,
  p_port integer,
  p_secure boolean,
  p_username text,
  p_encrypted_secret text,
  p_smtp_host text default null,
  p_smtp_port integer default null,
  p_smtp_security text default null
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
    raise exception 'A valid Open Media session is required.' using errcode = '42501';
  end if;

  insert into private.mail_accounts (
    user_id, email, protocol, host, port, secure, username, encrypted_secret, status,
    smtp_host, smtp_port, smtp_security
  ) values (
    v_user_id, p_email, p_protocol, p_host, p_port, p_secure, p_username, p_encrypted_secret, 'connected',
    nullif(p_smtp_host, ''), p_smtp_port, nullif(p_smtp_security, '')
  )
  returning id into v_account_id;

  return v_account_id;
end;
$$;

create or replace function public.open_media_get_mail_account(p_account_id uuid)
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
  status text,
  smtp_host text,
  smtp_port integer,
  smtp_security text
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
    raise exception 'A valid Open Media session is required.' using errcode = '42501';
  end if;

  return query
  select
    account.id, account.user_id, account.email, account.protocol, account.host, account.port,
    account.secure, account.username, account.encrypted_secret, account.status,
    account.smtp_host, account.smtp_port, account.smtp_security
  from private.mail_accounts as account
  where account.id = p_account_id
    and account.user_id = v_user_id;
end;
$$;

-- The account list now says whether a mailbox can send. Credentials are never returned.
drop function if exists public.open_media_list_mail_accounts();
create function public.open_media_list_mail_accounts()
returns table (
  id uuid,
  email text,
  protocol text,
  status text,
  can_send boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    account.id,
    account.email,
    account.protocol,
    account.status,
    account.smtp_host is not null,
    account.created_at,
    account.updated_at
  from private.mail_accounts as account
  where account.user_id = auth.uid()
  order by account.created_at desc;
$$;

-- Stored email for the signed-in person, newest first, for the Messages inbox.
create or replace function public.open_media_list_mail_messages(p_limit integer default 500)
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
  body_text text
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    message.id,
    message.account_id,
    account.email,
    message.source_message_id,
    message.mailbox,
    message.subject,
    message.sender,
    message.recipients,
    message.sent_at,
    message.body_text
  from private.mail_messages as message
  join private.mail_accounts as account on account.id = message.account_id
  where message.user_id = auth.uid()
  order by message.sent_at desc
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

revoke all on function public.open_media_save_mail_account(text, text, text, integer, boolean, text, text, text, integer, text) from public, anon;
revoke all on function public.open_media_get_mail_account(uuid) from public, anon;
revoke all on function public.open_media_list_mail_accounts() from public, anon;
revoke all on function public.open_media_list_mail_messages(integer) from public, anon;
grant execute on function public.open_media_save_mail_account(text, text, text, integer, boolean, text, text, text, integer, text) to authenticated;
grant execute on function public.open_media_get_mail_account(uuid) to authenticated;
grant execute on function public.open_media_list_mail_accounts() to authenticated;
grant execute on function public.open_media_list_mail_messages(integer) to authenticated;

comment on function public.open_media_list_mail_messages(integer)
  is 'Signed-in person''s stored email (inbound and sent), newest first, for the people-first Messages inbox.';
