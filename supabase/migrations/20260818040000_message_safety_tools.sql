create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocked_idx
  on public.user_blocks (blocked_id, blocker_id);

create table if not exists public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  reason text not null check (reason in ('unwanted_contact', 'harassment', 'spam', 'other')),
  details text not null default '' check (char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'reviewing', 'closed')),
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_user_id)
);

create index if not exists abuse_reports_reporter_created_idx
  on public.abuse_reports (reporter_id, created_at desc);
create index if not exists abuse_reports_status_created_idx
  on public.abuse_reports (status, created_at);

alter table public.user_blocks enable row level security;
alter table public.abuse_reports enable row level security;

create policy "People manage their own blocks"
on public.user_blocks for all to authenticated
using ((select auth.uid()) = blocker_id)
with check ((select auth.uid()) = blocker_id);

create policy "People read their own reports"
on public.abuse_reports for select to authenticated
using ((select auth.uid()) = reporter_id);

create policy "People create their own reports"
on public.abuse_reports for insert to authenticated
with check ((select auth.uid()) = reporter_id);

grant select on public.user_blocks to authenticated;
grant select on public.abuse_reports to authenticated;

create or replace function app_private.users_are_blocked(p_first uuid, p_second uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks as block
    where (block.blocker_id = p_first and block.blocked_id = p_second)
       or (block.blocker_id = p_second and block.blocked_id = p_first)
  );
$$;

revoke all on function app_private.users_are_blocked(uuid, uuid) from public, anon, authenticated;

create or replace function app_private.start_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversation_id uuid;
  v_lock_key text;
begin
  if v_user_id is null then
    raise exception 'A valid Open Media session is required.' using errcode = '42501';
  end if;
  if p_other_user_id is null or p_other_user_id = v_user_id then
    raise exception 'Choose another person.' using errcode = '22023';
  end if;

  v_lock_key := least(v_user_id::text, p_other_user_id::text) || ':' || greatest(v_user_id::text, p_other_user_id::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_key, 0));

  if not exists (select 1 from public.profiles where id = p_other_user_id) then
    raise exception 'That Open Media profile does not exist.' using errcode = 'P0002';
  end if;
  if app_private.users_are_blocked(v_user_id, p_other_user_id) then
    raise exception 'This conversation is blocked.' using errcode = '42501';
  end if;

  select conversation.id into v_conversation_id
  from public.conversations conversation
  where conversation.kind = 'direct'
    and exists (select 1 from public.conversation_members member where member.conversation_id = conversation.id and member.user_id = v_user_id)
    and exists (select 1 from public.conversation_members member where member.conversation_id = conversation.id and member.user_id = p_other_user_id)
    and 2 = (select count(*) from public.conversation_members member where member.conversation_id = conversation.id)
  order by conversation.created_at
  limit 1;

  if v_conversation_id is null then
    insert into public.conversations (kind, created_by) values ('direct', v_user_id) returning id into v_conversation_id;
    insert into public.conversation_members (conversation_id, user_id, role)
    values (v_conversation_id, v_user_id, 'owner'), (v_conversation_id, p_other_user_id, 'member');
  end if;
  return v_conversation_id;
end;
$$;

create or replace function app_private.enforce_message_abuse_controls()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or pg_catalog.current_setting('role', true) <> 'authenticated' then
    return new;
  end if;
  if new.sender_id <> v_user_id then
    raise exception 'Messages must be sent as the signed-in user.' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.conversation_members as member
    join public.conversations as conversation on conversation.id = member.conversation_id
    where member.conversation_id = new.conversation_id
      and conversation.kind = 'direct'
      and member.user_id <> v_user_id
      and app_private.users_are_blocked(v_user_id, member.user_id)
  ) then
    raise exception 'This conversation is blocked.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 1));
  if (select count(*) from public.messages where sender_id = v_user_id and created_at >= pg_catalog.clock_timestamp() - interval '1 minute') >= 60 then
    raise exception 'You are sending too quickly. Wait a minute and try again.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.messages where sender_id = v_user_id and created_at >= pg_catalog.clock_timestamp() - interval '1 day') >= 1000 then
    raise exception 'Your daily message limit has been reached. Try again tomorrow.' using errcode = 'P0001';
  end if;
  new.created_at := pg_catalog.clock_timestamp();
  new.transport := 'open_media';
  return new;
end;
$$;

create or replace function public.open_media_set_user_blocked(p_blocked_user_id uuid, p_blocked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'A valid Open Media session is required.' using errcode = '42501'; end if;
  if p_blocked_user_id is null or p_blocked_user_id = v_user_id then
    raise exception 'Choose another person.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_blocked_user_id) then
    raise exception 'That Open Media profile does not exist.' using errcode = 'P0002';
  end if;
  if p_blocked then
    insert into public.user_blocks (blocker_id, blocked_id)
    values (v_user_id, p_blocked_user_id)
    on conflict do nothing;
  else
    delete from public.user_blocks where blocker_id = v_user_id and blocked_id = p_blocked_user_id;
  end if;
end;
$$;

revoke all on function public.open_media_set_user_blocked(uuid, boolean) from public, anon;
grant execute on function public.open_media_set_user_blocked(uuid, boolean) to authenticated;

create or replace function public.open_media_report_conversation(
  p_reported_user_id uuid,
  p_conversation_id uuid,
  p_message_id uuid default null,
  p_reason text default 'unwanted_contact',
  p_details text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_report_id uuid;
begin
  if v_user_id is null then raise exception 'A valid Open Media session is required.' using errcode = '42501'; end if;
  if not app_private.is_conversation_member(p_conversation_id, v_user_id)
     or not app_private.is_conversation_member(p_conversation_id, p_reported_user_id) then
    raise exception 'The reported conversation is unavailable.' using errcode = '42501';
  end if;
  if p_message_id is not null and not exists (
    select 1 from public.messages where id = p_message_id and conversation_id = p_conversation_id and sender_id = p_reported_user_id
  ) then
    raise exception 'The reported message is unavailable.' using errcode = '42501';
  end if;
  insert into public.abuse_reports (reporter_id, reported_user_id, conversation_id, message_id, reason, details)
  values (v_user_id, p_reported_user_id, p_conversation_id, p_message_id, p_reason, btrim(p_details))
  returning id into v_report_id;
  return v_report_id;
end;
$$;

revoke all on function public.open_media_report_conversation(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.open_media_report_conversation(uuid, uuid, uuid, text, text) to authenticated;

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
    'profile', coalesce((select to_jsonb(profile) from public.profiles as profile where profile.id = auth.uid()), 'null'::jsonb),
    'conversations', coalesce((select jsonb_agg(to_jsonb(conversation) order by conversation.created_at) from public.conversations as conversation), '[]'::jsonb),
    'conversationMembers', coalesce((select jsonb_agg(to_jsonb(member) order by member.joined_at) from public.conversation_members as member), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(message) order by message.created_at) from public.messages as message), '[]'::jsonb),
    'blockedUsers', coalesce((select jsonb_agg(to_jsonb(block) order by block.created_at) from public.user_blocks as block), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(report) order by report.created_at) from public.abuse_reports as report), '[]'::jsonb),
    'mailAccounts', coalesce((select jsonb_agg(jsonb_build_object('id', account.id, 'email', account.email, 'protocol', account.protocol, 'status', account.status, 'createdAt', account.created_at, 'updatedAt', account.updated_at) order by account.created_at) from private.mail_accounts as account where account.user_id = auth.uid()), '[]'::jsonb),
    'mailMessages', coalesce((select jsonb_agg(jsonb_build_object('id', message.id, 'accountId', message.account_id, 'sourceMessageId', message.source_message_id, 'mailbox', message.mailbox, 'subject', message.subject, 'sender', message.sender, 'recipients', message.recipients, 'sentAt', message.sent_at, 'bodyText', message.body_text, 'createdAt', message.created_at) order by message.sent_at) from private.mail_messages as message where message.user_id = auth.uid()), '[]'::jsonb)
  );
$$;

comment on table public.user_blocks is 'User-controlled reversible blocks. Either direction prevents new native messages.';
comment on table public.abuse_reports is 'Private user reports for operator review; reported users cannot read report records.';
