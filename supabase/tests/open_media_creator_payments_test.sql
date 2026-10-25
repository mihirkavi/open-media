begin;

select plan(17);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'creator@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'fan@example.test', '', now(), now(), now()),
  ('c3000000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated', 'reader@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-0000000000c1', 'creator', 'Creator', ''), ('b2000000-0000-0000-0000-0000000000c2', 'fan', 'Fan', ''), ('c3000000-0000-0000-0000-0000000000c3', 'reader', 'Reader', '');
select public.open_media_set_payment_account('a1000000-0000-0000-0000-0000000000c1', 'acct_creator123', true, true, true, false);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000c1', true);
select throws_ok($$ select public.open_media_create_paid_post(gen_random_uuid(), '', 'secret', 500) $$, '22023', null, 'a paid post needs a public preview');
select throws_ok($$ select public.open_media_create_paid_post(gen_random_uuid(), 'Preview', 'secret', 10) $$, '22023', null, 'prices start at 0.50');
select set_config('test.post', public.open_media_create_paid_post('d4000000-0000-0000-0000-0000000000c4', 'My recipe, preview', 'The secret is brown butter.', 500) ->> 'id', true);
select is(public.open_media_paid_post_content(current_setting('test.post')::uuid) ->> 'body', 'The secret is brown butter.', 'the author reads their own paid part');

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select is((public.open_media_public_posts(5, null, null, 'creator', null) -> 0 -> 'paid' ->> 'priceMinor')::bigint, 500::bigint, 'everyone sees the price');
select is(public.open_media_public_posts(5, null, null, 'creator', null) -> 0 -> 'paid' -> 'body', 'null'::jsonb, 'guests never get the paid part');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000c2', true);
select is(public.open_media_paid_post_content(current_setting('test.post')::uuid) -> 'body', 'null'::jsonb, 'nothing before paying');
select throws_ok($$ select public.open_media_create_payment_intent(gen_random_uuid(), 'tip', current_setting('test.post')::uuid, 'card', null, 500) $$, '22023', null, 'no tips until the creator turns them on');
select set_config('test.unlock', public.open_media_create_payment_intent(gen_random_uuid(), 'paid_post', current_setting('test.post')::uuid, 'card', null, 1) ->> 'id', true);
select is((public.open_media_payment(current_setting('test.unlock')::uuid) ->> 'amountMinor')::bigint, 500::bigint, 'the unlock price comes from the post, not the payer');
select is(public.open_media_paid_post_content(current_setting('test.post')::uuid) -> 'body', 'null'::jsonb, 'starting a payment unlocks nothing');

reset role;
select public.open_media_record_payment_event(current_setting('test.unlock')::uuid, 'confirmed', 'stripe_webhook', 'cs_unlock');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000c2', true);
select is(public.open_media_paid_post_content(current_setting('test.post')::uuid) ->> 'body', 'The secret is brown butter.', 'a confirmed payment unlocks the post');
select throws_ok($$ select public.open_media_create_payment_intent(gen_random_uuid(), 'paid_post', current_setting('test.post')::uuid, 'card') $$, '22023', null, 'a post cannot be bought twice');

select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000c3', true);
select is(public.open_media_public_posts(5, null, null, 'creator', null) -> 0 -> 'paid' -> 'body', 'null'::jsonb, 'other people still see only the preview');

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000c1', true);
select is(public.open_media_set_tips_enabled(true), true, 'creators turn tips on');
select throws_ok($$ select public.open_media_create_payment_intent(gen_random_uuid(), 'tip', current_setting('test.post')::uuid, 'card', null, 500) $$, '22023', null, 'creators cannot tip themselves');

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000c2', true);
select throws_ok($$ select public.open_media_create_payment_intent(gen_random_uuid(), 'tip', current_setting('test.post')::uuid, 'card', null, 50) $$, '22023', null, 'tips start at one dollar');
select is((public.open_media_create_payment_intent(gen_random_uuid(), 'tip', current_setting('test.post')::uuid, 'card', null, 700) ->> 'amountMinor')::bigint, 700::bigint, 'the payer chooses the tip');

reset role;
select public.open_media_record_payment_event(current_setting('test.unlock')::uuid, 'refunded', 'stripe_webhook');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000c2', true);
select is(public.open_media_paid_post_content(current_setting('test.post')::uuid) -> 'body', 'null'::jsonb, 'a refund locks the post again');

select * from finish();
rollback;
