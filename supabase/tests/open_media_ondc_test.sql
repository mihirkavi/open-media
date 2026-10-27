begin;

select plan(13);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'seller@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated', 'private@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-0000000000e1', 'ashaweaves', 'Asha', ''), ('b2000000-0000-0000-0000-0000000000e2', 'quietseller', 'Quiet', '');
update public.profiles set visibility = 'private' where id = 'b2000000-0000-0000-0000-0000000000e2';
-- An established seller: new accounts are limited to three listings in their first week (ADR 0016).
update public.profiles set created_at = now() - interval '30 days' where id = 'a1000000-0000-0000-0000-0000000000e1';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000e1', true);
select public.open_media_create_listing_post('d4000000-0000-0000-0000-0000000000e1', 'Hand-woven, natural dyes', '{"kind":"product","title":"Cotton saree","priceMinor":250000,"currency":"INR"}');
select public.open_media_create_listing_post('d4000000-0000-0000-0000-0000000000e2', '', '{"kind":"product","title":"Silk stole","priceMinor":90000,"currency":"INR","availability":"sold_out"}');
select public.open_media_create_listing_post('d4000000-0000-0000-0000-0000000000e3', '', '{"kind":"product","title":"Desk","priceMinor":2500,"currency":"USD"}');
select public.open_media_create_listing_post('d4000000-0000-0000-0000-0000000000e4', '', '{"kind":"service","title":"Tailoring","priceMinor":50000,"currency":"INR"}');

select is(public.open_media_get_ondc_store(), null, 'no store until the seller saves one');
select is(public.open_media_set_ondc_store('{"storeName":"Draft"}') ->> 'enabled', 'false', 'a store that is off may be a draft');
select throws_ok($$ select public.open_media_set_ondc_store('{"enabled":true,"storeName":"Asha Handlooms"}') $$, '22023', null, 'turning it on needs every detail');
select throws_ok($$ select public.open_media_set_ondc_store('{"enabled":true,"storeName":"Asha Handlooms","category":"ONDC:RET12","building":"12 MG Road","locality":"Ashok Nagar","city":"Bengaluru","state":"Karnataka","areaCode":"560001","stdCode":"080","gps":"12.971600,77.594600","phone":"9876543210","email":"asha@example.test"}') $$, '22023', null, 'and the declaration');
select throws_ok($$ select public.open_media_set_ondc_store('{"enabled":true,"storeName":"Asha Handlooms","category":"ONDC:RET10","building":"12 MG Road","locality":"Ashok Nagar","city":"Bengaluru","state":"Karnataka","areaCode":"560001","stdCode":"080","gps":"12.971600,77.594600","phone":"9876543210","email":"asha@example.test","declarationAccepted":true}') $$, '22023', null, 'food categories are refused');
select is(public.open_media_set_ondc_store('{"enabled":true,"storeName":"Asha Handlooms","category":"ONDC:RET12","building":"12 MG Road","locality":"Ashok Nagar","city":"Bengaluru","state":"Karnataka","areaCode":"560001","stdCode":"080","gps":"12.971600,77.594600","phone":"9876543210","email":"asha@example.test","declarationAccepted":true}') ->> 'enabled', 'true', 'a complete store turns on');
select is((public.open_media_get_ondc_store() ->> 'offeredItems')::int, 1, 'only priced INR products that are not sold out are offered');
select throws_ok($$ select public.open_media_ondc_catalog('080') $$, '42501', null, 'people cannot read the catalog with its contact details');

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000e2', true);
select throws_ok($$ select public.open_media_set_ondc_store('{"enabled":true,"storeName":"Quiet Shop","category":"ONDC:RET16","building":"1 Main St","locality":"Indiranagar","city":"Bengaluru","state":"Karnataka","areaCode":"560038","stdCode":"080","gps":"12.97,77.64","phone":"9876500000","email":"q@example.test","declarationAccepted":true}') $$, '22023', null, 'a private profile cannot open a store');

reset role;
set local role anon;
select throws_ok($$ select public.open_media_ondc_items(array['d4000000-0000-0000-0000-0000000000e1'::uuid]) $$, '42501', null, 'guests cannot read it either');

reset role;
set local role service_role;
select is(jsonb_array_length(public.open_media_ondc_catalog('080') -> 0 -> 'items'), 1, 'the Worker reads the Bengaluru catalog');
select is(public.open_media_ondc_catalog('080', 'ONDC:RET12', 'saree') -> 0 -> 'items' -> 0 ->> 'title', 'Cotton saree', 'search by item name');
select is(jsonb_array_length(public.open_media_ondc_catalog('011')), 0, 'other cities see nothing');

select * from finish();
rollback;
