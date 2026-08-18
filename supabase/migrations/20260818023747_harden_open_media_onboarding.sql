alter table public.conversations
  drop constraint if exists conversations_created_by_fkey;
alter table public.conversations
  alter column created_by drop not null;
alter table public.conversations
  add constraint conversations_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.messages
  drop constraint if exists messages_sender_id_fkey;
alter table public.messages
  add constraint messages_sender_id_fkey
  foreign key (sender_id) references auth.users(id) on delete cascade;

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

create or replace function app_private.touch_conversation_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set updated_at = greatest(updated_at, new.created_at)
  where id = new.conversation_id;
  return new;
end;
$$;

revoke all on function app_private.touch_conversation_from_message() from public, anon, authenticated;
drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
after insert on public.messages
for each row execute function app_private.touch_conversation_from_message();

create or replace function app_private.delete_current_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'A valid Open Media session is required.' using errcode = '42501';
  end if;

  delete from public.conversations conversation
  where conversation.kind = 'direct'
    and exists (
      select 1 from public.conversation_members member
      where member.conversation_id = conversation.id
        and member.user_id = v_user_id
    );

  delete from auth.users where id = v_user_id;
  if not found then
    raise exception 'Open Media account not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function app_private.delete_current_account() from public, anon;
grant execute on function app_private.delete_current_account() to authenticated;

create or replace function public.open_media_delete_account()
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.delete_current_account();
$$;

revoke all on function public.open_media_delete_account() from public, anon;
grant execute on function public.open_media_delete_account() to authenticated;

comment on function public.open_media_delete_account()
  is 'Deletes the authenticated account, its private mail data, authored messages, memberships, profile, and direct conversations.';
