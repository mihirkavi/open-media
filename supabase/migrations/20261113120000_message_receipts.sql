-- Read receipts and real unread counts for Open Media messages (ADR 0026).
--
-- When a person's app has fetched a conversation, it is "delivered" to them; when they open it, it
-- is "read". Both are stored here, per person and conversation, never on conversation_members:
-- every member can read that table, and a person who turns read receipts off must not have their
-- read time readable by anyone. Nothing here is reachable except through the functions below.
-- Read receipts are reciprocal, like WhatsApp's: a person who stops sending them also stops seeing
-- other people's. Delivery is always shared, since it only says the app received the message.

create table if not exists public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key (conversation_id, user_id)
);

alter table public.conversation_reads enable row level security;
revoke all on public.conversation_reads from anon, authenticated;

create table if not exists public.message_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  share_read_receipts boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.message_settings enable row level security;
revoke all on public.message_settings from anon, authenticated;

create or replace function app_private.shares_read_receipts(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select share_read_receipts from public.message_settings where user_id = p_user_id), true);
$$;

revoke all on function app_private.shares_read_receipts(uuid) from public, anon, authenticated;

-- Everything the caller's app has fetched is delivered: called after loading conversations.
create or replace function public.open_media_mark_delivered()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  insert into public.conversation_reads (conversation_id, user_id, delivered_at)
  select member.conversation_id, v_user, now()
  from public.conversation_members member
  where member.user_id = v_user
  on conflict (conversation_id, user_id) do update set delivered_at = excluded.delivered_at;
end;
$$;

-- Opening a conversation reads everything in it so far.
create or replace function public.open_media_mark_read(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not app_private.is_conversation_member(p_conversation_id, v_user) then
    raise exception 'That conversation isn''t yours.' using errcode = '42501';
  end if;
  insert into public.conversation_reads (conversation_id, user_id, delivered_at, read_at)
  values (p_conversation_id, v_user, v_now, v_now)
  on conflict (conversation_id, user_id) do update set delivered_at = v_now, read_at = v_now;
  return v_now;
end;
$$;

-- Delivery and read times for every member of the caller's conversations. The caller always gets
-- their own (for unread counts). Another person's read time is shown only when both of them share
-- read receipts.
create or replace function public.open_media_conversation_receipts(p_conversation_ids uuid[])
returns table (conversation_id uuid, user_id uuid, delivered_at timestamptz, read_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select reads.conversation_id, reads.user_id, reads.delivered_at,
    case
      when reads.user_id = auth.uid() then reads.read_at
      when app_private.shares_read_receipts(auth.uid()) and app_private.shares_read_receipts(reads.user_id) then reads.read_at
      else null
    end
  from public.conversation_reads reads
  where auth.uid() is not null
    and reads.conversation_id = any(p_conversation_ids[1:200])
    and app_private.is_conversation_member(reads.conversation_id, auth.uid());
$$;

create or replace function public.open_media_message_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('shareReadReceipts', app_private.shares_read_receipts(auth.uid()))
  where auth.uid() is not null;
$$;

create or replace function public.open_media_set_read_receipts(p_share boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  insert into public.message_settings (user_id, share_read_receipts, updated_at)
  values (v_user, coalesce(p_share, true), now())
  on conflict (user_id) do update set share_read_receipts = excluded.share_read_receipts, updated_at = now();
  return jsonb_build_object('shareReadReceipts', coalesce(p_share, true));
end;
$$;

revoke all on function public.open_media_mark_delivered() from public, anon;
revoke all on function public.open_media_mark_read(uuid) from public, anon;
revoke all on function public.open_media_conversation_receipts(uuid[]) from public, anon;
revoke all on function public.open_media_message_settings() from public, anon;
revoke all on function public.open_media_set_read_receipts(boolean) from public, anon;
grant execute on function public.open_media_mark_delivered() to authenticated;
grant execute on function public.open_media_mark_read(uuid) to authenticated;
grant execute on function public.open_media_conversation_receipts(uuid[]) to authenticated;
grant execute on function public.open_media_message_settings() to authenticated;
grant execute on function public.open_media_set_read_receipts(boolean) to authenticated;
