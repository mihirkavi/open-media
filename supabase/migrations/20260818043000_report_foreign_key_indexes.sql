create index if not exists abuse_reports_reported_user_idx
  on public.abuse_reports (reported_user_id);
create index if not exists abuse_reports_conversation_idx
  on public.abuse_reports (conversation_id)
  where conversation_id is not null;
create index if not exists abuse_reports_message_idx
  on public.abuse_reports (message_id)
  where message_id is not null;
