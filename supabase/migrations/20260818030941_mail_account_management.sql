create or replace function public.open_media_list_mail_accounts()
returns table (
  id uuid,
  email text,
  protocol text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security invoker
set search_path = ''
stable
as $$
  select
    account.id,
    account.email,
    account.protocol,
    account.status,
    account.created_at,
    account.updated_at
  from private.mail_accounts as account
  where account.user_id = (select auth.uid())
  order by account.created_at desc;
$$;

create or replace function public.open_media_delete_mail_account(p_account_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from private.mail_accounts
  where id = p_account_id
    and user_id = auth.uid();

  return found;
end;
$$;

revoke all on function public.open_media_list_mail_accounts() from public, anon;
revoke all on function public.open_media_delete_mail_account(uuid) from public, anon;
grant execute on function public.open_media_list_mail_accounts() to authenticated;
grant execute on function public.open_media_delete_mail_account(uuid) to authenticated;
grant delete on private.mail_accounts to authenticated;

comment on function public.open_media_list_mail_accounts()
  is 'Lists safe mailbox metadata for the authenticated Open Media user without exposing credentials.';
comment on function public.open_media_delete_mail_account(uuid)
  is 'Deletes one mailbox and its imported messages only when it belongs to the authenticated Open Media user.';

create or replace function public.open_media_export_account_data()
returns jsonb
language sql
security invoker
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'formatVersion', 1,
    'exportedAt', now(),
    'userId', auth.uid(),
    'profile', coalesce((
      select to_jsonb(profile)
      from public.profiles as profile
      where profile.id = auth.uid()
    ), 'null'::jsonb),
    'conversations', coalesce((
      select jsonb_agg(to_jsonb(conversation) order by conversation.created_at)
      from public.conversations as conversation
    ), '[]'::jsonb),
    'conversationMembers', coalesce((
      select jsonb_agg(to_jsonb(member) order by member.joined_at)
      from public.conversation_members as member
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(to_jsonb(message) order by message.created_at)
      from public.messages as message
    ), '[]'::jsonb),
    'mailAccounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', account.id,
        'email', account.email,
        'protocol', account.protocol,
        'status', account.status,
        'createdAt', account.created_at,
        'updatedAt', account.updated_at
      ) order by account.created_at)
      from private.mail_accounts as account
      where account.user_id = auth.uid()
    ), '[]'::jsonb),
    'mailMessages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', message.id,
        'accountId', message.account_id,
        'sourceMessageId', message.source_message_id,
        'mailbox', message.mailbox,
        'subject', message.subject,
        'sender', message.sender,
        'recipients', message.recipients,
        'sentAt', message.sent_at,
        'bodyText', message.body_text,
        'createdAt', message.created_at
      ) order by message.sent_at)
      from private.mail_messages as message
      where message.user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.open_media_export_account_data() from public, anon;
grant execute on function public.open_media_export_account_data() to authenticated;

comment on function public.open_media_export_account_data()
  is 'Exports the authenticated user data that Open Media stores, excluding encrypted mailbox credentials.';
