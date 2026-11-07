begin;

select plan(9);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'pia@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'noa@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-0000000000a1', 'pia', 'Pia', ''), ('b2000000-0000-0000-0000-0000000000b2', 'noa', 'Noa', '');
-- Pia has a passkey; Noa doesn't.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values ('f1000000-0000-0000-0000-0000000000f1', 'a1000000-0000-0000-0000-0000000000a1', 'MacBook', 'webauthn', 'verified', now(), now());

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'open_media_require_passkey_step')),
  0, 'every public table with row-level security requires the passkey step');

select ok(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'open_media_require_passkey_step'), 'stored files require it too');

create table public.open_media_passkey_policy_probe (id int primary key);
alter table public.open_media_passkey_policy_probe enable row level security;
select ok(exists (select 1 from pg_policies where tablename = 'open_media_passkey_policy_probe' and policyname = 'open_media_require_passkey_step'), 'tables added later get the policy automatically');

set local role authenticated;

-- Pia after her password, before her passkey (aal1).
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
select is(public.open_media_session_meets_mfa(), false, 'a password alone is not enough once a passkey is added');
select is((select count(*)::int from public.profiles where id = 'a1000000-0000-0000-0000-0000000000a1'), 0, 'her rows stay hidden until the passkey step');
select throws_ok($$ select public.open_media_pre_request() $$, 'PGRST', null, 'every API request is refused until the passkey step');

-- After her passkey (aal2).
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from public.profiles where id = 'a1000000-0000-0000-0000-0000000000a1'), 1, 'after the passkey she sees her profile');

-- Noa has no passkey: a password or email code alone is fine.
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-0000-0000-0000000000b2","role":"authenticated","aal":"aal1"}', true);
select is(public.open_media_session_meets_mfa(), true, 'people without a passkey are unaffected');
select lives_ok($$ select public.open_media_pre_request() $$, 'their API requests go through');

select * from finish();
rollback;
