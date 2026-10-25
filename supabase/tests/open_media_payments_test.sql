begin;

select plan(22);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'seller@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'buyer@example.test', '', now(), now(), now()),
  ('c3000000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated', 'other@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-0000000000a1', 'seller', 'Seller', ''), ('b2000000-0000-0000-0000-0000000000b2', 'buyer', 'Buyer', ''), ('c3000000-0000-0000-0000-0000000000c3', 'other', 'Other', '');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000a1', true);
select public.open_media_create_listing_post('d4000000-0000-0000-0000-0000000000d4', '', '{"kind":"product","title":"Desk","priceMinor":2500,"currency":"USD"}');
select set_config('test.listing', (select id::text from public.posts where client_id = 'd4000000-0000-0000-0000-0000000000d4'), true);
select throws_ok($$ select public.open_media_create_payment_intent(gen_random_uuid(), 'listing', current_setting('test.listing')::uuid, 'card') $$, '22023', null, 'sellers cannot pay themselves');

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000b2', true);
select throws_ok($$ select public.open_media_create_payment_intent(gen_random_uuid(), 'listing', current_setting('test.listing')::uuid, 'card') $$, '22023', null, 'no card payment before the seller sets up Stripe');
select throws_ok($$ select public.open_media_set_payment_account(auth.uid(), 'acct_forged123', true, true, true, false) $$, '42501', null, 'people cannot mark their own Stripe account ready');

reset role;
select public.open_media_set_payment_account('a1000000-0000-0000-0000-0000000000a1', 'acct_test12345', true, true, true, false);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000b2', true);
select set_config('test.card', public.open_media_create_payment_intent('e5000000-0000-0000-0000-0000000000e5', 'listing', current_setting('test.listing')::uuid, 'card') ->> 'id', true);
select is((public.open_media_payment(current_setting('test.card')::uuid) ->> 'amountMinor')::bigint, 2500::bigint, 'the amount comes from the listing');
select is(public.open_media_create_payment_intent('e5000000-0000-0000-0000-0000000000e5', 'listing', current_setting('test.listing')::uuid, 'card') ->> 'id', current_setting('test.card'), 'the same idempotency key returns the same payment');
select is((public.open_media_payment(current_setting('test.card')::uuid) ->> 'platformFeeMinor')::bigint, 0::bigint, 'no Open Media fee for now');
select throws_ok($$ update public.payment_intents set status = 'confirmed' where id = current_setting('test.card')::uuid $$, '42501', null, 'payers cannot change a payment directly');
select throws_ok($$ select public.open_media_record_payment_event(current_setting('test.card')::uuid, 'confirmed', 'stripe_webhook') $$, '42501', null, 'payers cannot forge a confirmation');

select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000c3', true);
select is(public.open_media_payment(current_setting('test.card')::uuid), null, 'others cannot see the payment');

reset role;
select throws_ok($$ select public.open_media_record_payment_event(current_setting('test.card')::uuid, 'confirmed', 'server') $$, '22023', null, 'confirmation needs provider evidence');
select throws_ok($$ select public.open_media_record_payment_event(current_setting('test.card')::uuid, 'refunded', 'stripe_webhook') $$, '22023', null, 'an unpaid payment cannot be refunded');
select is(public.open_media_record_payment_event(current_setting('test.card')::uuid, 'confirmed', 'stripe_webhook', 'cs_test_1') ->> 'status', 'confirmed', 'a Stripe webhook confirms');
select is((public.open_media_record_payment_event(current_setting('test.card')::uuid, 'confirmed', 'stripe_webhook', 'cs_test_1') ->> 'changed')::boolean, false, 'a retried webhook changes nothing');
select throws_ok($$ select public.open_media_record_payment_event(current_setting('test.card')::uuid, 'failed', 'stripe_webhook') $$, '22023', null, 'a confirmed payment cannot fail later');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000a1', true);
select is(public.open_media_payment(current_setting('test.card')::uuid) ->> 'direction', 'received', 'the seller sees it as received');

-- USDC on Base Sepolia
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000b2', true);
select throws_ok($$ select public.open_media_create_payment_intent(gen_random_uuid(), 'listing', current_setting('test.listing')::uuid, 'onchain', 'base-sepolia') $$, '22023', null, 'no USDC payment before the seller links a wallet');

reset role;
select public.open_media_add_wallet('a1000000-0000-0000-0000-0000000000a1', 'base-sepolia', '0xAbCdEf0000000000000000000000000000000001');
select throws_ok($$ select public.open_media_add_wallet('c3000000-0000-0000-0000-0000000000c3', 'base-sepolia', '0xabcdef0000000000000000000000000000000001') $$, '23505', null, 'one wallet belongs to one account');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000b2', true);
select set_config('test.chain', public.open_media_create_payment_intent(gen_random_uuid(), 'listing', current_setting('test.listing')::uuid, 'onchain', 'base-sepolia') ->> 'id', true);
select is((public.open_media_payment(current_setting('test.chain')::uuid) ->> 'amountMinor')::bigint, 25000000::bigint, '$25.00 becomes 25 USDC in base units');
select is(public.open_media_payment(current_setting('test.chain')::uuid) ->> 'recipientAddress', '0xabcdef0000000000000000000000000000000001', 'the seller''s wallet is copied onto the payment');
select is(public.open_media_submit_onchain_payment(current_setting('test.chain')::uuid, '0x' || repeat('ab', 32)) ->> 'status', 'submitted', 'the payer names the transaction');
select set_config('test.chain2', public.open_media_create_payment_intent(gen_random_uuid(), 'listing', current_setting('test.listing')::uuid, 'onchain', 'base-sepolia') ->> 'id', true);
select throws_ok($$ select public.open_media_submit_onchain_payment(current_setting('test.chain2')::uuid, '0x' || repeat('ab', 32)) $$, '23505', null, 'one transaction cannot pay twice');

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000a1', true);
select public.open_media_update_listing(current_setting('test.listing')::uuid, '{"availability":"sold_out"}');
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000b2', true);
select throws_ok($$ select public.open_media_create_payment_intent(gen_random_uuid(), 'listing', current_setting('test.listing')::uuid, 'card') $$, '22023', null, 'sold-out listings cannot be bought');

select * from finish();
rollback;
