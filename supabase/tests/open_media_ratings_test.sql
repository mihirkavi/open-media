begin;

select plan(10);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'shop@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated', 'rater@example.test', '', now(), now(), now()),
  ('c3000000-0000-0000-0000-0000000000f3', 'authenticated', 'authenticated', 'tier4@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-0000000000f1', 'shop', 'Shop', ''), ('b2000000-0000-0000-0000-0000000000f2', 'rater', 'Rae', ''), ('c3000000-0000-0000-0000-0000000000f3', 'quiet', 'Quiet', '');

-- The server verifies two people; only one chooses to show the legal name (tier 5).
select public.open_media_record_verification('b2000000-0000-0000-0000-0000000000f2', 'stripe_identity', 'vs_r1', 'verified', 'aaaa.bbbb.cccc');
select public.open_media_record_verification('c3000000-0000-0000-0000-0000000000f3', 'stripe_identity', 'vs_r2', 'verified', 'aaaa.bbbb.cccc');
update public.profiles set name_disclosure = 'verified_legal' where id = 'b2000000-0000-0000-0000-0000000000f2';
select public.open_media_set_disclosed_legal_name('b2000000-0000-0000-0000-0000000000f2', 'Rae Rater');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f1', true);
select public.open_media_create_listing_post('d4000000-0000-0000-0000-0000000000f4', '', '{"kind":"service","title":"Bike repair","priceMinor":3000}');
-- Raters cannot read the listings table, so remember the post id while signed in as the seller.
select set_config('test.listing', (select id::text from public.posts where client_id = 'd4000000-0000-0000-0000-0000000000f4'), true);
select throws_ok($$ select public.open_media_rate_listing(current_setting('test.listing')::uuid, 5) $$, '42501', null, 'an unverified seller cannot rate');

select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000f3', true);
select throws_ok($$ select public.open_media_rate_listing(current_setting('test.listing')::uuid, 5) $$, '42501', null, 'tier 4 (legal name withheld) cannot rate');

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000f2', true);
select throws_ok($$ select public.open_media_rate_listing(current_setting('test.listing')::uuid, 6) $$, '22023', null, 'six stars are refused');
select is((public.open_media_rate_listing(current_setting('test.listing')::uuid, 4) ->> 'count')::int, 1, 'a tier 5 person rates');
select is((public.open_media_rate_listing(current_setting('test.listing')::uuid, 2) ->> 'count')::int, 1, 'changing a rating does not count twice');
select is((public.open_media_public_posts(5, null, null, 'shop', null) -> 0 -> 'listing' -> 'rating' ->> 'average')::numeric, 2.0, 'the feed shows the new average');
select is((public.open_media_public_posts(5, null, null, 'shop', null) -> 0 -> 'listing' -> 'rating' ->> 'mine')::int, 2, 'and the rater sees their own stars');
select throws_ok($$ insert into public.listing_ratings (listing_group_id, rater_id, stars) values (gen_random_uuid(), auth.uid(), 5) $$, '42501', null, 'ratings cannot be written directly');
select is((public.open_media_remove_rating(current_setting('test.listing')::uuid) ->> 'count')::int, 0, 'a rating can be withdrawn');

reset role;
select is((select count(*)::int from public.listing_rating_history), 3, 'every change is kept for abuse review');

select * from finish();
rollback;
