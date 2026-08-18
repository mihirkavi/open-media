create extension if not exists pgcrypto;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null check (handle = lower(handle) and handle ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  bio text not null default '' check (char_length(bio) <= 240),
  avatar_url text,
  onboarding_completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_handle_lower_idx on public.profiles (lower(handle));

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct' check (kind in ('direct', 'group')),
  title text check (title is null or char_length(title) between 1 and 100),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id, conversation_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  client_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 8000),
  transport text not null default 'open_media' check (transport in ('open_media', 'email')),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  unique (sender_id, client_id)
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create or replace function app_private.is_conversation_member(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members member
    where member.conversation_id = p_conversation_id
      and member.user_id = p_user_id
  );
$$;

revoke all on function app_private.is_conversation_member(uuid, uuid) from public, anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.is_conversation_member(uuid, uuid) to authenticated;

create policy "Authenticated people can discover profiles"
on public.profiles for select to authenticated
using (true);

create policy "People create their own profile"
on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);

create policy "People update their own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Members read conversations"
on public.conversations for select to authenticated
using (app_private.is_conversation_member(id, (select auth.uid())));

create policy "Creators create conversations"
on public.conversations for insert to authenticated
with check ((select auth.uid()) = created_by);

create policy "Members read conversation membership"
on public.conversation_members for select to authenticated
using (app_private.is_conversation_member(conversation_id, (select auth.uid())));

create policy "Members read messages"
on public.messages for select to authenticated
using (app_private.is_conversation_member(conversation_id, (select auth.uid())));

create policy "Members send their own messages"
on public.messages for insert to authenticated
with check (
  (select auth.uid()) = sender_id
  and app_private.is_conversation_member(conversation_id, (select auth.uid()))
);

create policy "Senders edit their own messages"
on public.messages for update to authenticated
using ((select auth.uid()) = sender_id)
with check (
  (select auth.uid()) = sender_id
  and app_private.is_conversation_member(conversation_id, (select auth.uid()))
);

create or replace function public.open_media_start_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversation_id uuid;
begin
  if v_user_id is null then
    raise exception 'A valid Open Media session is required.' using errcode = '42501';
  end if;
  if p_other_user_id = v_user_id then
    raise exception 'Choose another person.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_other_user_id) then
    raise exception 'That Open Media profile does not exist.' using errcode = 'P0002';
  end if;

  select conversation.id into v_conversation_id
  from public.conversations conversation
  where conversation.kind = 'direct'
    and exists (
      select 1 from public.conversation_members member
      where member.conversation_id = conversation.id and member.user_id = v_user_id
    )
    and exists (
      select 1 from public.conversation_members member
      where member.conversation_id = conversation.id and member.user_id = p_other_user_id
    )
    and 2 = (
      select count(*) from public.conversation_members member
      where member.conversation_id = conversation.id
    )
  order by conversation.created_at
  limit 1;

  if v_conversation_id is null then
    insert into public.conversations (kind, created_by)
    values ('direct', v_user_id)
    returning id into v_conversation_id;

    insert into public.conversation_members (conversation_id, user_id, role)
    values
      (v_conversation_id, v_user_id, 'owner'),
      (v_conversation_id, p_other_user_id, 'member');
  end if;

  return v_conversation_id;
end;
$$;

revoke all on function public.open_media_start_direct_conversation(uuid) from public, anon;
grant execute on function public.open_media_start_direct_conversation(uuid) to authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.conversations to authenticated;
grant select on public.conversation_members to authenticated;
grant select, insert, update on public.messages to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

comment on table public.profiles is 'Public-to-authenticated Open Media onboarding profiles. Email addresses stay in auth.users.';
comment on table public.messages is 'Open Media native messages. Imported email retains separate transport semantics.';
