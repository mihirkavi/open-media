-- Passkeys as a second sign-in step (ADR 0034).
--
-- Someone who adds a passkey must use it after their password or email code. The app asks for it,
-- but the app is not the lock: this migration makes the database refuse a session that hasn't
-- done its passkey step (Supabase marks it aal1; after the passkey it is aal2). People without a
-- passkey are unaffected.
--
-- Three layers, because each covers what the others can't:
--   1. A PostgREST pre-request check refuses every API call (tables and functions, including
--      security-definer functions that bypass row-level security).
--   2. A restrictive row-level security policy on every public table and on storage objects, which
--      also covers Realtime and Storage (they don't go through PostgREST).
--   3. The Worker checks the same function before using its service key (session.ts).

create or replace function public.open_media_session_meets_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or auth.uid() is null
    or not exists (
      select 1 from auth.mfa_factors factor
      where factor.user_id = auth.uid() and factor.status = 'verified'
    );
$$;

comment on function public.open_media_session_meets_mfa() is
  'True unless the signed-in person has a passkey and this session has not used it yet (ADR 0034).';

revoke all on function public.open_media_session_meets_mfa() from public;
grant execute on function public.open_media_session_meets_mfa() to anon, authenticated, service_role;

-- 1. Every API request.
create or replace function public.open_media_pre_request()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' and not public.open_media_session_meets_mfa() then
    raise sqlstate 'PGRST' using
      message = '{"code":"open_media_passkey_required","message":"Confirm this sign-in with your passkey first."}',
      detail = '{"status":403,"headers":{}}';
  end if;
end;
$$;

grant execute on function public.open_media_pre_request() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.open_media_pre_request';
notify pgrst, 'reload config';

-- 2. Every table with row-level security, now and later (see open_media_require_passkey_step_on_new_tables).
create or replace function public.open_media_add_passkey_policy(target regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = (select nspname from pg_namespace where oid = (select relnamespace from pg_class where oid = target))
      and tablename = (select relname from pg_class where oid = target)
      and policyname = 'open_media_require_passkey_step'
  ) then
    execute format(
      'create policy open_media_require_passkey_step on %s as restrictive for all to authenticated using (public.open_media_session_meets_mfa()) with check (public.open_media_session_meets_mfa())',
      target
    );
  end if;
end;
$$;

revoke all on function public.open_media_add_passkey_policy(regclass) from public, anon, authenticated;

do $$
declare
  item record;
begin
  for item in
    select c.oid::regclass as target
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    perform public.open_media_add_passkey_policy(item.target);
  end loop;
end;
$$;

select public.open_media_add_passkey_policy('storage.objects'::regclass);

-- Tables that turn on row-level security in later migrations get the policy too.
create or replace function public.open_media_require_passkey_step_on_new_tables()
returns event_trigger
language plpgsql
set search_path = ''
as $$
declare
  command record;
begin
  for command in select * from pg_event_trigger_ddl_commands()
  loop
    if command.object_type = 'table' and command.schema_name = 'public' and exists (
      select 1 from pg_class where oid = command.objid and relrowsecurity
    ) then
      perform public.open_media_add_passkey_policy(command.objid::regclass);
    end if;
  end loop;
end;
$$;

drop event trigger if exists open_media_require_passkey_step;
create event trigger open_media_require_passkey_step
  on ddl_command_end
  when tag in ('ALTER TABLE', 'CREATE TABLE')
  execute function public.open_media_require_passkey_step_on_new_tables();
