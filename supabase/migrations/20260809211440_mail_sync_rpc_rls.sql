grant usage on schema private to authenticated;
grant select, insert on private.mail_accounts to authenticated;
grant select, insert, update on private.mail_messages to authenticated;

create policy "Users insert their own mail accounts"
on private.mail_accounts
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users insert their own mail messages"
on private.mail_messages
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users update their own mail messages"
on private.mail_messages
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

alter function public.convo_save_mail_account(text, text, text, integer, boolean, text, text)
  security invoker;
alter function public.convo_get_mail_account(uuid)
  security invoker;
alter function public.convo_save_mail_messages(uuid, jsonb)
  security invoker;
