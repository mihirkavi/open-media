-- Stored senders for these messages, so a sync can refresh mail saved before display names were
-- kept ("Bank of America" instead of onlinebanking@…) by downloading it once more.
create or replace function public.open_media_mail_known_senders(p_account_id uuid, p_source_message_ids text[])
returns table (source_message_id text, sender text)
language sql
security definer
set search_path = ''
stable
as $$
  select message.source_message_id, message.sender
  from private.mail_messages as message
  where message.account_id = p_account_id
    and message.user_id = auth.uid()
    and message.source_message_id = any(p_source_message_ids[1:200]);
$$;

revoke all on function public.open_media_mail_known_senders(uuid, text[]) from public, anon;
grant execute on function public.open_media_mail_known_senders(uuid, text[]) to authenticated;
