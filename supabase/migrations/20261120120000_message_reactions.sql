-- Message reactions, like iMessage tapbacks: each person can put one emoji on a message in an Open
-- Media conversation they belong to. Choosing the same emoji again takes it off; choosing another
-- replaces it. Everyone in the conversation sees them.
--
-- Clients only read the table; every change goes through open_media_set_reaction, which checks
-- membership and blocks the same way sending a message does.

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  -- One emoji (with skin tone or joiner sequences), never words or links.
  emoji text not null check (char_length(emoji) between 1 and 16 and emoji !~ '[[:alnum:][:space:]<>/\\:.]'),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_reactions_conversation_idx on public.message_reactions (conversation_id);

alter table public.message_reactions enable row level security;

drop policy if exists "Members read reactions" on public.message_reactions;
create policy "Members read reactions"
on public.message_reactions for select to authenticated
using (app_private.is_conversation_member(conversation_id, (select auth.uid())));

revoke all on public.message_reactions from public, anon, authenticated;
grant select on public.message_reactions to authenticated;

-- Sets, replaces or (with null, or the emoji already there) removes the caller's reaction.
-- Returns the caller's reaction afterwards, or null when there is none.
create or replace function public.open_media_set_reaction(p_message_id uuid, p_emoji text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_conversation uuid;
  v_current text;
  v_emoji text := nullif(btrim(coalesce(p_emoji, '')), '');
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select message.conversation_id into v_conversation from public.messages message where message.id = p_message_id;
  if v_conversation is null or not app_private.is_conversation_member(v_conversation, v_user) then
    raise exception 'That message isn''t in your conversations.' using errcode = '42501';
  end if;
  select reaction.emoji into v_current from public.message_reactions reaction
  where reaction.message_id = p_message_id and reaction.user_id = v_user;
  if v_emoji is null or v_emoji = v_current then
    delete from public.message_reactions where message_id = p_message_id and user_id = v_user;
    return null;
  end if;
  -- Like sending, reacting is off while either person has blocked the other.
  if exists (
    select 1 from public.conversation_members member
    where member.conversation_id = v_conversation and member.user_id <> v_user
      and app_private.users_are_blocked(v_user, member.user_id)
  ) then
    raise exception 'Messaging is paused in this conversation.' using errcode = '42501';
  end if;
  insert into public.message_reactions (message_id, user_id, conversation_id, emoji)
  values (p_message_id, v_user, v_conversation, v_emoji)
  on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  return v_emoji;
end;
$$;

revoke all on function public.open_media_set_reaction(uuid, text) from public, anon;
grant execute on function public.open_media_set_reaction(uuid, text) to authenticated;

-- Reactions arrive live, like messages.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end;
$$;

comment on table public.message_reactions is 'One emoji reaction per person per Open Media message (tapbacks). Changed only through open_media_set_reaction.';
