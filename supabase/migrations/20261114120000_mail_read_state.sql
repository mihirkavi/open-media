-- Email read state (ADR 0026): whether each inbound message is read (\Seen) on the mail server.
--
-- Mail sync writes the flag it reads from IMAP, so mail read in another app shows as read here,
-- and opening an email conversation in Open Media marks its mail read both here and on the server.
-- Mail stored before this, POP mail (POP has no read state) and sent mail all count as read, so the
-- rollout doesn't suddenly mark old mail unread.

alter table private.mail_messages add column if not exists seen boolean not null default true;

create index if not exists mail_messages_unseen_idx on private.mail_messages (user_id) where not seen;

-- Sets read state for the caller's own messages in one mailbox. Returns how many changed.
create or replace function public.open_media_set_mail_seen(p_account_id uuid, p_seen text[], p_unseen text[] default '{}')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_changed integer := 0;
  v_rows integer;
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  update private.mail_messages
  set seen = true
  where user_id = v_user and account_id = p_account_id and not seen
    and source_message_id = any((coalesce(p_seen, '{}'))[1:500]);
  get diagnostics v_rows = row_count;
  v_changed := v_changed + v_rows;
  update private.mail_messages
  set seen = false
  where user_id = v_user and account_id = p_account_id and seen and mailbox <> 'Sent'
    and source_message_id = any((coalesce(p_unseen, '{}'))[1:500]);
  get diagnostics v_rows = row_count;
  return v_changed + v_rows;
end;
$$;

-- The caller's unread inbound mail, by mailbox and Message-ID.
create or replace function public.open_media_unseen_mail()
returns table (account_id uuid, source_message_id text)
language sql
security definer
set search_path = ''
stable
as $$
  select message.account_id, message.source_message_id
  from private.mail_messages as message
  where message.user_id = auth.uid() and not message.seen and message.mailbox <> 'Sent'
  limit 2000;
$$;

revoke all on function public.open_media_set_mail_seen(uuid, text[], text[]) from public, anon;
revoke all on function public.open_media_unseen_mail() from public, anon;
grant execute on function public.open_media_set_mail_seen(uuid, text[], text[]) to authenticated;
grant execute on function public.open_media_unseen_mail() to authenticated;
