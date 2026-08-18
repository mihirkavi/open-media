create index if not exists conversations_created_by_idx
  on public.conversations (created_by);

create or replace function app_private.start_direct_conversation(p_other_user_id uuid)
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

revoke all on function app_private.start_direct_conversation(uuid) from public, anon;
grant execute on function app_private.start_direct_conversation(uuid) to authenticated;

create or replace function public.open_media_start_direct_conversation(p_other_user_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app_private.start_direct_conversation(p_other_user_id);
$$;

revoke all on function public.open_media_start_direct_conversation(uuid) from public, anon;
grant execute on function public.open_media_start_direct_conversation(uuid) to authenticated;
