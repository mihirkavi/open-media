drop policy if exists "People create their own reports" on public.abuse_reports;

create unique index if not exists abuse_reports_reporter_message_idx
  on public.abuse_reports (reporter_id, message_id)
  where message_id is not null;

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
  if v_user_id is null then
    raise exception 'A valid Open Media session is required.' using errcode = '42501';
  end if;
  if not app_private.is_conversation_member(p_conversation_id, v_user_id)
     or not app_private.is_conversation_member(p_conversation_id, p_reported_user_id) then
    raise exception 'The reported conversation is unavailable.' using errcode = '42501';
  end if;
  if p_message_id is not null and not exists (
    select 1 from public.messages
    where id = p_message_id
      and conversation_id = p_conversation_id
      and sender_id = p_reported_user_id
  ) then
    raise exception 'The reported message is unavailable.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 2));
  if (select count(*) from public.abuse_reports where reporter_id = v_user_id and created_at >= pg_catalog.clock_timestamp() - interval '1 day') >= 20 then
    raise exception 'Your daily report limit has been reached.' using errcode = 'P0001';
  end if;

  if p_message_id is not null then
    select id into v_report_id
    from public.abuse_reports
    where reporter_id = v_user_id and message_id = p_message_id;
    if v_report_id is not null then return v_report_id; end if;
  end if;

  insert into public.abuse_reports (reporter_id, reported_user_id, conversation_id, message_id, reason, details)
  values (v_user_id, p_reported_user_id, p_conversation_id, p_message_id, p_reason, coalesce(btrim(p_details), ''))
  returning id into v_report_id;
  return v_report_id;
end;
$$;

comment on function public.open_media_report_conversation(uuid, uuid, uuid, text, text)
  is 'Validates and rate-limits private abuse reports; duplicate reports of the same message are idempotent.';
