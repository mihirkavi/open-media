-- Mark as unread (ADR 0026 §Mark unread): swiping a conversation right in Messages marks it unread.
--
-- Like Apple Messages and Mail, this is the person's own reminder: their read time and the read
-- receipt the other person sees stay as they were. The flag only makes the conversation count as
-- unread for them until they open it again, which clears it.

alter table public.conversation_reads add column if not exists marked_unread boolean not null default false;

create or replace function public.open_media_mark_unread(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not app_private.is_conversation_member(p_conversation_id, v_user) then
    raise exception 'That conversation isn''t yours.' using errcode = '42501';
  end if;
  insert into public.conversation_reads (conversation_id, user_id, marked_unread)
  values (p_conversation_id, v_user, true)
  on conflict (conversation_id, user_id) do update set marked_unread = true;
end;
$$;

-- Opening a conversation reads everything in it so far, and clears a "marked unread".
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
  on conflict (conversation_id, user_id) do update set delivered_at = v_now, read_at = v_now, marked_unread = false;
  return v_now;
end;
$$;

-- The caller's own conversations they marked unread. Only ever their own: nobody else learns it.
create or replace function public.open_media_marked_unread()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select reads.conversation_id
  from public.conversation_reads reads
  where reads.user_id = auth.uid() and reads.marked_unread
    and app_private.is_conversation_member(reads.conversation_id, auth.uid())
  limit 2000;
$$;

revoke all on function public.open_media_mark_unread(uuid) from public, anon;
revoke all on function public.open_media_marked_unread() from public, anon;
grant execute on function public.open_media_mark_unread(uuid) to authenticated;
grant execute on function public.open_media_marked_unread() to authenticated;
