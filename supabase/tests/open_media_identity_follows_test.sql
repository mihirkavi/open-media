begin;

select plan(21);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'priv@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'fan@example.test', '', now(), now(), now()),
  ('c3000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', 'anon@example.test', '', now(), now(), now());

insert into public.profiles (id, handle, display_name, bio)
values
  ('a1000000-0000-0000-0000-00000000000a', 'priv', 'Priya Private', 'secret bio'),
  ('b2000000-0000-0000-0000-00000000000b', 'fan', 'Fan', ''),
  ('c3000000-0000-0000-0000-00000000000c', 'nightowl', 'Hidden Name', '');

insert into public.posts (id, author_id, client_id, body)
values ('d4000000-0000-0000-0000-00000000000d', 'a1000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-00000000000e', 'only for followers');

-- Clients cannot verify themselves or claim a legal name.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-00000000000c', true);
select throws_ok(
  $$ insert into public.identity_verifications (user_id, provider, provider_reference, status) values (auth.uid(), 'stripe_identity', 'vs_fake', 'verified') $$,
  '42501', null, 'a client cannot write a verification'
);
select throws_ok(
  $$ select public.open_media_record_verification(auth.uid(), 'stripe_identity', 'vs_fake', 'verified') $$,
  '42501', null, 'a client cannot call the server-only recorder'
);
select throws_ok(
  $$ update public.profiles set name_disclosure = 'verified_legal' where id = auth.uid() $$,
  '22023', null, 'the legal name cannot be chosen before verification'
);

-- The server verifies nightowl (tier 4: legal name withheld).
reset role;
select public.open_media_record_verification('c3000000-0000-0000-0000-00000000000c', 'stripe_identity', 'vs_1', 'verified', 'aaaa.bbbb.cccc', 'US', true);
update public.profiles set name_disclosure = 'handle_only' where id = 'c3000000-0000-0000-0000-00000000000c';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-00000000000b', true);
select is(public.open_media_public_profile('nightowl')->>'displayName', 'nightowl', 'a tier 4 handle-only person is shown by handle');
select is((public.open_media_public_profile('nightowl')->>'verified')::boolean, true, 'and has the blue tick');
select ok(public.open_media_public_profile('nightowl')::text not like '%Hidden Name%', 'their declared name never appears');
select is((select count(*)::int from public.profiles where id = 'c3000000-0000-0000-0000-00000000000c'), 0, 'their profile row cannot be read directly');
select is((select count(*)::int from public.identity_verifications), 0, 'nobody else can read a verification');

-- Tier 5: the owner chooses to show the legal name; the server fills it in.
reset role;
update public.profiles set name_disclosure = 'verified_legal' where id = 'c3000000-0000-0000-0000-00000000000c';
select public.open_media_set_disclosed_legal_name('c3000000-0000-0000-0000-00000000000c', 'Nora Owl');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-00000000000c', true);
select is((public.open_media_my_identity()->>'tier')::int, 5, 'showing the verified legal name is tier 5');
select is(public.open_media_public_profile('nightowl')->>'displayName', 'Nora Owl', 'tier 5 shows the legal name');
update public.profiles set name_disclosure = 'handle_only' where id = auth.uid();
reset role;
select is((select disclosed_legal_name from public.identity_verifications where user_id = 'c3000000-0000-0000-0000-00000000000c'), null, 'switching back removes the plain legal name');
select public.open_media_record_verification('c3000000-0000-0000-0000-00000000000c', 'stripe_identity', 'vs_1', 'revoked');
select is((select legal_name_ciphertext from public.identity_verifications where user_id = 'c3000000-0000-0000-0000-00000000000c'), null, 'a revoked verification drops the encrypted name too');

-- Private accounts and follow requests.
update public.profiles set visibility = 'private' where id = 'a1000000-0000-0000-0000-00000000000a';
set local role anon;
select is(public.open_media_public_posts(20, null, null, 'priv', null), '[]'::jsonb, 'guests see no posts from a private account');
select is((public.open_media_public_profile('priv')->>'canView')::boolean, false, 'guests see only the card');
select ok(public.open_media_public_profile('priv')::text not like '%secret bio%', 'the bio stays hidden');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-00000000000b', true);
select is(public.open_media_follow('priv')->>'status', 'pending', 'following a private account sends a request');
select is(public.open_media_public_post('d4000000-0000-0000-0000-00000000000d'), null, 'a pending request does not reveal posts');
select throws_ok($$ insert into public.follows (follower_id, followee_id, status) values (auth.uid(), 'a1000000-0000-0000-0000-00000000000a', 'accepted') $$, '42501', null, 'nobody can accept their own request');

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-00000000000a', true);
select is(jsonb_array_length(public.open_media_my_follows()->'requests'), 1, 'the owner sees the request');
select public.open_media_answer_follow_request('b2000000-0000-0000-0000-00000000000b', true);

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-00000000000b', true);
select is(public.open_media_public_post('d4000000-0000-0000-0000-00000000000d')->>'body', 'only for followers', 'an accepted follower sees the posts');

-- Blocks override follows.
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-00000000000a', true);
select public.open_media_set_user_blocked('b2000000-0000-0000-0000-00000000000b', true);
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-00000000000b', true);
select is(public.open_media_public_post('d4000000-0000-0000-0000-00000000000d'), null, 'a block hides everything, even from a follower');

select * from finish();
rollback;
