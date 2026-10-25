begin;

select plan(12);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ann@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ben@example.test', '', now(), now(), now());

insert into public.profiles (id, handle, display_name, bio)
values
  ('a1000000-0000-0000-0000-000000000001', 'ann', 'Ann', ''),
  ('b2000000-0000-0000-0000-000000000002', 'ben', 'Ben', '');

-- Linked network accounts
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$ update public.profiles set linked_accounts = '[{"network":"farcaster","handle":"ann"},{"network":"hive","handle":"ann.h"}]' where id = auth.uid() $$,
  'an owner can list accounts on open networks'
);
select throws_ok(
  $$ update public.profiles set linked_accounts = '[{"network":"myspace","handle":"ann"}]' where id = auth.uid() $$,
  '23514', null, 'unknown networks are refused'
);
select throws_ok(
  $$ update public.profiles set linked_accounts = '[{"network":"lens","handle":"<script>"}]' where id = auth.uid() $$,
  '23514', null, 'malformed handles are refused'
);
select is(
  (public.open_media_public_profile('ann')->'linkedAccounts'->0->>'network'),
  'farcaster',
  'the public profile includes linked accounts'
);

-- Contact cards are owner-only
select lives_ok(
  $$ insert into public.contact_cards (id, ciphertext) values ('c1000000-0000-0000-0000-000000000001', 'aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb.cccccccccccc') $$,
  'an owner stores an encrypted card'
);
select throws_ok(
  $$ insert into public.contact_cards (id, ciphertext) values ('c1000000-0000-0000-0000-000000000009', 'Rebecca, +1 555 0001234') $$,
  '23514', null, 'plaintext is refused by the ciphertext check'
);
select is((select count(*)::int from public.contact_cards), 1, 'the owner sees their card');

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
select is((select count(*)::int from public.contact_cards), 0, 'another person cannot see it');
select throws_ok(
  $$ insert into public.contact_cards (id, owner_id, ciphertext) values ('c2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb.cccccccccccc') $$,
  '42501', null, 'nobody can write a card into someone else''s address book'
);
update public.contact_cards set ciphertext = 'zzzzzzzzzzzzzzzz.zzzzzzzzzzzzzzzzzzzzzz.zzzzzzzzzzzz' where id = 'c1000000-0000-0000-0000-000000000001';
delete from public.contact_cards where id = 'c1000000-0000-0000-0000-000000000001';
reset role;
select is(
  (select ciphertext from public.contact_cards where id = 'c1000000-0000-0000-0000-000000000001'),
  'aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb.cccccccccccc',
  'another person can neither change nor delete it'
);

set local role anon;
select throws_ok($$ select count(*) from public.contact_cards $$, '42501', null, 'guests cannot read contact cards at all');
reset role;
select is((public.open_media_public_profile('ann') ? 'ciphertext'), false, 'public profiles carry nothing from contact cards');

select * from finish();
rollback;
