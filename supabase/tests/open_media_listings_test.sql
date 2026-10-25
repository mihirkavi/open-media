begin;

select plan(11);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'seller@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'buyer@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-0000000000a1', 'seller', 'Sam Seller', ''), ('b2000000-0000-0000-0000-0000000000b2', 'buyer', 'Bea Buyer', '');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000a1', true);

select is(
  public.open_media_create_listing_post('c3000000-0000-0000-0000-0000000000c3', '', '{"kind":"product","title":"Walnut desk","priceMinor":45000,"currency":"usd","location":"Oakland"}') -> 'listing' ->> 'priceMinor',
  '45000', 'a seller lists a product with an integer price'
);
select is(
  (select body from public.posts where client_id = 'c3000000-0000-0000-0000-0000000000c3'),
  'Walnut desk', 'an empty caption becomes the title'
);
select is(
  public.open_media_create_listing_post('c3000000-0000-0000-0000-0000000000c3', '', '{"kind":"product","title":"Walnut desk","priceMinor":45000}') -> 'listing' ->> 'title',
  'Walnut desk', 'retrying with the same client id does not create a second listing'
);
select is((select count(*)::int from public.post_listings), 1, 'still one listing');
select throws_ok(
  $$ select public.open_media_create_listing_post('c3000000-0000-0000-0000-0000000000c4', '', '{"kind":"vehicle","title":"Car"}') $$,
  '22023', null, 'unknown kinds are refused'
);
select throws_ok(
  $$ select public.open_media_create_listing_post('c3000000-0000-0000-0000-0000000000c5', '', '{"kind":"service","title":"Tutoring","priceMinor":"12.50"}') $$,
  '22023', null, 'prices must be whole minor units'
);
select throws_ok(
  $$ insert into public.post_listings (post_id, author_id, kind, title) select id, author_id, 'product', 'x' from public.posts limit 1 $$,
  '42501', null, 'listings cannot be written directly'
);

select is(
  (public.open_media_public_posts(20, null, null, 'seller', null) -> 0 -> 'listing' ->> 'kind'),
  'product', 'the public feed carries the listing'
);

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000b2', true);
select throws_ok(
  $$ select public.open_media_update_listing((select post_id from public.post_listings limit 1), '{"availability":"sold_out"}') $$,
  'P0002', null, 'someone else cannot change a listing'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000a1', true);
select is(
  public.open_media_update_listing((select id from public.posts where client_id = 'c3000000-0000-0000-0000-0000000000c3'), '{"availability":"sold_out","priceMinor":40000}') ->> 'availability',
  'sold_out', 'the seller marks it sold out'
);
select is(
  (public.open_media_public_post((select id from public.posts where client_id = 'c3000000-0000-0000-0000-0000000000c3')) -> 'listing' ->> 'priceMinor'),
  '40000', 'and the new price is public'
);

select * from finish();
rollback;
