begin;

select plan(4);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'withpw@example.test', '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyzABCDE', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'codeonly@example.test', '', now(), now(), now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is(public.open_media_has_password(), true, 'an account with a password says so');
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select is(public.open_media_has_password(), false, 'an email-code account has none');

reset role;
set local role anon;
select throws_ok($$ select public.open_media_has_password() $$, '42501', null, 'signed-out callers cannot ask');
reset role;
select is((select count(*)::int from information_schema.routine_privileges where routine_name = 'open_media_has_password' and grantee = 'anon'), 0, 'anon has no grant');

select * from finish();
rollback;
