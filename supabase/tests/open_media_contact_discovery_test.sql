begin;

select plan(11);

insert into auth.users (id, aud, role, email, phone, encrypted_password, email_confirmed_at, phone_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', 'viewer@example.test', null, '', now(), null, now(), now()),
  ('b2000000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated', 'Priya@Example.test', '15550001234', '', now(), now(), now(), now()),
  ('c3000000-0000-0000-0000-0000000000d3', 'authenticated', 'authenticated', 'hidden@example.test', null, '', now(), null, now(), now()),
  ('d4000000-0000-0000-0000-0000000000d4', 'authenticated', 'authenticated', 'unconfirmed@example.test', '15550009999', '', null, null, now(), now()),
  ('e5000000-0000-0000-0000-0000000000d5', 'authenticated', 'authenticated', 'blocker@example.test', null, '', now(), null, now(), now());

insert into public.profiles (id, handle, display_name, bio)
values
  ('a1000000-0000-0000-0000-0000000000d1', 'viewer', 'Viewer', ''),
  ('b2000000-0000-0000-0000-0000000000d2', 'priya', 'Priya', ''),
  ('c3000000-0000-0000-0000-0000000000d3', 'hidden', 'Hidden', ''),
  ('d4000000-0000-0000-0000-0000000000d4', 'unconfirmed', 'Unconfirmed', ''),
  ('e5000000-0000-0000-0000-0000000000d5', 'blocker', 'Blocker', '');

update public.profiles set discoverable = false where id = 'c3000000-0000-0000-0000-0000000000d3';
insert into public.user_blocks (blocker_id, blocked_id) values ('e5000000-0000-0000-0000-0000000000d5', 'a1000000-0000-0000-0000-0000000000d1');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);

select is(
  public.open_media_discover_contacts(array['priya@example.test'], null),
  '[{"kind":"email","value":"priya@example.test","handle":"priya"}]'::jsonb,
  'a confirmed email finds its account, whatever its case'
);
select is(
  public.open_media_discover_contacts(null, array['+1 (555) 000-1234']),
  '[{"kind":"phone","value":"+15550001234","handle":"priya"}]'::jsonb,
  'a confirmed number with its country code finds its account'
);
select is(public.open_media_discover_contacts(null, array['555 000 1234']), '[]'::jsonb, 'a number without a country code is too ambiguous');
select is(public.open_media_discover_contacts(array['hidden@example.test'], null), '[]'::jsonb, 'people who turned discovery off are never found');
select is(public.open_media_discover_contacts(array['unconfirmed@example.test'], array['+15550009999']), '[]'::jsonb, 'unconfirmed emails and numbers never match');
select is(public.open_media_discover_contacts(array['blocker@example.test'], null), '[]'::jsonb, 'someone who blocked you is never found');
select is(public.open_media_discover_contacts(array['viewer@example.test'], null), '[]'::jsonb, 'you never find yourself');
select throws_ok(
  $$ select public.open_media_discover_contacts((select array_agg('p' || n || '@example.test') from generate_series(1, 501) as n), null) $$,
  '22023', null, 'at most 500 at a time'
);
select is((public.open_media_my_identity() ->> 'discoverable')::boolean, true, 'discovery is on by default');

reset role;
set local role anon;
select throws_ok($$ select public.open_media_discover_contacts(array['priya@example.test'], null) $$, '42501', null, 'signed-out callers cannot ask');
reset role;
select is((select count(*)::int from information_schema.routine_privileges where routine_name = 'open_media_discover_contacts' and grantee = 'anon'), 0, 'anon has no grant');

select * from finish();
rollback;
