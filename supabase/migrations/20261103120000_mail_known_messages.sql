-- Which of these messages are already stored for one mailbox, so a sync downloads only new mail.
create or replace function public.open_media_mail_known_message_ids(p_account_id uuid, p_source_message_ids text[])
returns setof text
language sql
security definer
set search_path = ''
stable
as $$
  select message.source_message_id
  from private.mail_messages as message
  where message.account_id = p_account_id
    and message.user_id = auth.uid()
    and message.source_message_id = any(p_source_message_ids[1:200]);
$$;

revoke all on function public.open_media_mail_known_message_ids(uuid, text[]) from public, anon;
grant execute on function public.open_media_mail_known_message_ids(uuid, text[]) to authenticated;
