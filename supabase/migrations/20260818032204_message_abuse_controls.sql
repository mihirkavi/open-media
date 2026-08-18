create index if not exists messages_sender_created_idx
  on public.messages (sender_id, created_at desc);

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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 1));

  if (
    select count(*)
    from public.messages
    where sender_id = v_user_id
      and created_at >= pg_catalog.clock_timestamp() - interval '1 minute'
  ) >= 60 then
    raise exception 'You are sending too quickly. Wait a minute and try again.' using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.messages
    where sender_id = v_user_id
      and created_at >= pg_catalog.clock_timestamp() - interval '1 day'
  ) >= 1000 then
    raise exception 'Your daily message limit has been reached. Try again tomorrow.' using errcode = 'P0001';
  end if;

  new.created_at := pg_catalog.clock_timestamp();
  new.transport := 'open_media';
  return new;
end;
$$;

revoke all on function app_private.enforce_message_abuse_controls() from public, anon, authenticated;

drop trigger if exists messages_enforce_abuse_controls on public.messages;
create trigger messages_enforce_abuse_controls
before insert on public.messages
for each row execute function app_private.enforce_message_abuse_controls();

comment on function app_private.enforce_message_abuse_controls()
  is 'Prevents sender/transport spoofing, timestamp backdating, and basic message flooding for authenticated clients.';
