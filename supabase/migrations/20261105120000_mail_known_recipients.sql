-- Stored senders and recipients for these messages. Sync downloads a message once more when they
-- differ from the server's, which adds Cc recipients and names to mail saved before they were
-- kept, so emails with several people become group conversations.
drop function if exists public.open_media_mail_known_senders(uuid, text[]);
create function public.open_media_mail_known_senders(p_account_id uuid, p_source_message_ids text[])
returns table (source_message_id text, sender text, recipients text[])
language sql
security definer
set search_path = ''
stable
as $$
  select message.source_message_id, message.sender, message.recipients
  from private.mail_messages as message
  where message.account_id = p_account_id
    and message.user_id = auth.uid()
    and message.source_message_id = any(p_source_message_ids[1:200]);
$$;

revoke all on function public.open_media_mail_known_senders(uuid, text[]) from public, anon;
grant execute on function public.open_media_mail_known_senders(uuid, text[]) to authenticated;
