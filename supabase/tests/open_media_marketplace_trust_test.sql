begin;

select plan(43);

-- Sellers, a viewer, three verified people who verify listings, and an operator.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1600000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'seller16@example.test', '', now(), now(), now()),
  ('a1600000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'newbie16@example.test', '', now(), now(), now()),
  ('a1600000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'viewer16@example.test', '', now(), now(), now()),
  ('a1600000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'va16@example.test', '', now(), now(), now()),
  ('a1600000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'vb16@example.test', '', now(), now(), now()),
  ('a1600000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'vc16@example.test', '', now(), now(), now()),
  ('a1600000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'op16@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio, created_at)
values
  ('a1600000-0000-0000-0000-000000000001', 'seller16', 'Seller', '', now() - interval '60 days'),
  ('a1600000-0000-0000-0000-000000000002', 'newbie16', 'Newbie', '', now()),
  ('a1600000-0000-0000-0000-000000000003', 'viewer16', 'Viewer', '', now() - interval '40 days'),
  ('a1600000-0000-0000-0000-000000000004', 'va16', 'Verifier A', '', now() - interval '30 days'),
  ('a1600000-0000-0000-0000-000000000005', 'vb16', 'Verifier B', '', now() - interval '20 days'),
  ('a1600000-0000-0000-0000-000000000006', 'vc16', 'Verifier C', '', now() - interval '10 days'),
  ('a1600000-0000-0000-0000-000000000007', 'op16', 'Operator', '', now() - interval '90 days');
insert into public.identity_verifications (user_id, provider, provider_reference, status, verified_at)
select id, 'stripe_identity', 'vs_' || right(id::text, 4), 'verified', now()
from auth.users where id in ('a1600000-0000-0000-0000-000000000004', 'a1600000-0000-0000-0000-000000000005', 'a1600000-0000-0000-0000-000000000006');
insert into public.operators (user_id) values ('a1600000-0000-0000-0000-000000000007');

-- Test helpers that read past row-level security, so each role's own view can be checked separately.
create function pg_temp.lid(p_title text) returns uuid language sql security definer set search_path = '' as $$ select post_id from public.post_listings where title = p_title order by created_at desc limit 1 $$;
create function pg_temp.lupdated(p_title text) returns timestamptz language sql security definer set search_path = '' as $$ select updated_at from public.post_listings where title = p_title order by created_at desc limit 1 $$;
create function pg_temp.lstate(p_title text) returns text language sql security definer set search_path = '' as $$ select check_state from public.post_listings where title = p_title order by created_at desc limit 1 $$;
create function pg_temp.tid(p_code text) returns uuid language sql security definer set search_path = '' as $$ select id from public.verification_tasks where claim_code = p_code and not is_test limit 1 $$;
create function pg_temp.q(p_sql text) returns bigint language plpgsql security definer set search_path = '' as $$ declare v bigint; begin execute p_sql into v; return v; end $$;

select ok((select banned_until > now() + interval '100 years' and encrypted_password = '' from auth.users where id = app_private.notice_user_id()), 'nobody can sign in as the Open Media notices account');
select is((select display_name from public.profiles where id = app_private.notice_user_id()), 'Open Media', 'the notices account is called Open Media');

-- Posting: live at once, pending a check
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1600000-0000-0000-0000-000000000001', true);
select public.open_media_create_listing_post('c1600000-0000-0000-0000-000000000001', 'Get it at https://paypal-support.help/deal', '{"kind":"product","title":"Gift cards","priceMinor":5000,"currency":"USD"}');
select public.open_media_create_listing_post('c1600000-0000-0000-0000-000000000002', 'Handmade, see https://example.com/lamp', '{"kind":"product","title":"Walnut lamp","priceMinor":12000,"currency":"USD"}');
select is(pg_temp.lstate('Gift cards'), 'pending', 'new listings wait for their check');
select set_config('request.jwt.claim.sub', 'a1600000-0000-0000-0000-000000000003', true);
select ok(public.open_media_public_posts(20, null, null, 'seller16') @> '[{"listing":{"title":"Gift cards"}}]', 'a listing is live while its check is pending');
select throws_ok($$ select public.open_media_pending_listing_checks(10) $$, '42501', null, 'clients cannot read the check queue');
select throws_ok($$ select public.open_media_record_listing_check(pg_temp.lid('Gift cards'), now(), 'clear', '[]', null, '[]') $$, '42501', null, 'clients cannot record checks');

-- The Worker records a hold
reset role;
set local role service_role;
select is(jsonb_array_length(public.open_media_pending_listing_checks(10)) >= 2, true, 'the Worker reads pending listings');
select ok(public.open_media_record_listing_check(
  pg_temp.lid('Gift cards'),
  pg_temp.lupdated('Gift cards'),
  'held', '[{"code":"brand_impersonation","severity":"hold","message":"A link uses Paypal’s name on a site Paypal doesn’t own (paypal-support.help).","fix":"Link to the brand’s real site."}]',
  'Only you can see your listing “Gift cards” for now.', '[]'), 'a held outcome is recorded');
select ok(not public.open_media_record_listing_check(
  pg_temp.lid('Walnut lamp'), now() - interval '1 hour', 'clear', '[]', null, '[]'), 'a check of an older version of the listing is ignored');
select ok(public.open_media_record_listing_check(
  pg_temp.lid('Walnut lamp'),
  pg_temp.lupdated('Walnut lamp'),
  'review', '[{"code":"link_matches","severity":"review","message":"x","fix":"y"}]', null,
  '[{"code":"link_matches","question":"Does the linked page describe what this listing offers, from the same seller?"}]'), 'a closer-look outcome is recorded');
select is(pg_temp.q($q$select count(*) from public.verification_tasks where post_id = pg_temp.lid('Walnut lamp')$q$)::int, 1, 'a closer look creates verification tasks');
select is(public.open_media_deliver_notices(10), 1, 'the statement of reasons is delivered');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1600000-0000-0000-0000-000000000003', true);
select ok(not (public.open_media_public_posts(20, null, null, 'seller16') @> '[{"listing":{"title":"Gift cards"}}]'), 'other people do not see a held listing');
select is(public.open_media_public_post(pg_temp.lid('Gift cards')), null, 'a held listing cannot be opened by others');
select is((select count(*)::int from public.listing_checks), 0, 'other people cannot read a listing’s checks');
select throws_ok($$ select public.open_media_report_post(pg_temp.lid('Gift cards'), 'scam', '') $$, 'P0002', null, 'a held listing cannot be reported by people who cannot see it');

select set_config('request.jwt.claim.sub', 'a1600000-0000-0000-0000-000000000001', true);
select is(jsonb_path_query_first(public.open_media_public_posts(20, null, null, 'seller16'), '$[*] ? (@.listing.title == "Gift cards").listing.check.state') #>> '{}', 'held', 'the author still sees the held listing, with its state');
select ok((jsonb_path_query_first(public.open_media_public_posts(20, null, null, 'seller16'), '$[*] ? (@.listing.title == "Gift cards").listing.check.reason') #>> '{}') like '%paypal-support.help%', 'the author sees why');
select ok(exists (select 1 from public.messages m join public.conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
  where m.sender_id = '0e4d0000-0000-4000-8000-000000000001' and m.body like 'Only you can see%'), 'the author gets the statement of reasons in Messages');
select lives_ok($$ select public.open_media_create_listing_post('c1600000-0000-0000-0000-000000000003', 'Now at https://example.com/cards', '{"kind":"product","title":"Gift Cards","priceMinor":5000,"currency":"USD"}') $$, 'the author posts the listing again with the fix');
select is(pg_temp.q($q$select count(*) from public.posts p join public.post_listings l on l.post_id = p.id where lower(l.title) = 'gift cards' and p.removed_at is null$q$)::int, 1, 'the new listing replaces the held one');

-- Events
select lives_ok($$ select public.open_media_create_listing_post('c1600000-0000-0000-0000-000000000004', 'Bring a mat', '{"kind":"event","title":"Sunrise yoga","priceMinor":0,"currency":"USD","startsAt":"2028-05-04T13:30:00Z","timezone":"America/Los_Angeles","location":"Dolores Park"}') $$, 'members post events');
select is((select listing ->> 'startsAt' from (select public.open_media_public_post(pg_temp.lid('Sunrise yoga')) -> 'listing' as listing) e), '2028-05-04T13:30:00Z', 'an event carries its start time');
select throws_ok($$ select public.open_media_create_listing_post(gen_random_uuid(), '', '{"kind":"event","title":"Yesterday","startsAt":"2020-01-01T10:00:00Z"}') $$, '22023', null, 'events must be in the future');

-- New accounts are limited
select set_config('request.jwt.claim.sub', 'a1600000-0000-0000-0000-000000000002', true);
select public.open_media_create_listing_post(gen_random_uuid(), '', '{"kind":"product","title":"One"}');
select public.open_media_create_listing_post(gen_random_uuid(), '', '{"kind":"product","title":"Two"}');
select public.open_media_create_listing_post(gen_random_uuid(), '', '{"kind":"product","title":"Three"}');
select throws_ok($$ select public.open_media_create_listing_post(gen_random_uuid(), '', '{"kind":"product","title":"Four"}') $$, '54000', null, 'new accounts have up to three listings in their first week');

-- Weighted reports: two verified, established people reporting a scam hold the listing
select set_config('request.jwt.claim.sub', 'a1600000-0000-0000-0000-000000000004', true);
select public.open_media_report_post(pg_temp.lid('Walnut lamp'), 'scam', '');
select is(pg_temp.lstate('Walnut lamp'), 'review', 'one verified report does not hide a listing');
select set_config('request.jwt.claim.sub', 'a1600000-0000-0000-0000-000000000005', true);
select public.open_media_report_post(pg_temp.lid('Walnut lamp'), 'scam', '');
select is(pg_temp.lstate('Walnut lamp'), 'held', 'two verified scam reports hold the listing');

-- Operators decide through the Worker
reset role;
set local role service_role;
select throws_ok($$ select public.open_media_operator_queue('a1600000-0000-0000-0000-000000000003') $$, '42501', null, 'only operators see the review queue');
select ok(public.open_media_operator_queue('a1600000-0000-0000-0000-000000000007') -> 'listings' @> '[{"title":"Walnut lamp","state":"held"}]', 'the operator sees held listings');
select lives_ok($$ select public.open_media_operator_decide('a1600000-0000-0000-0000-000000000007', pg_temp.lid('Walnut lamp'), 'clear', 'The lamp and the link are genuine.') $$, 'the operator clears a listing');
select is(pg_temp.q($q$select count(*) from public.abuse_reports where post_id = pg_temp.lid('Walnut lamp') and outcome = 'rejected'$q$)::int, 2, 'the reports are marked rejected, which lowers those reporters’ weight');
select is(pg_temp.q($q$select count(*) from public.verification_tasks where post_id = pg_temp.lid('Walnut lamp') and is_test and expected_answer = 'yes'$q$)::int, 1, 'the decision becomes a test task for verifiers');

-- Community verification
select ok(public.open_media_record_listing_check(
  pg_temp.lid('Sunrise yoga'),
  pg_temp.lupdated('Sunrise yoga'),
  'review', '[]', null, '[{"code":"event_official","question":"Is this event listed on an official page with the same date, time and place?"}]'), 'an event goes for a closer look');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1600000-0000-0000-0000-000000000003', true);
select throws_ok($$ select public.open_media_next_verification_task() $$, '42501', null, 'only verified people can verify');
select set_config('request.jwt.claim.sub', 'a1600000-0000-0000-0000-000000000004', true);
-- Each verifier is given the open event task (the test task is skipped here by answering it first if it comes up).
reset role;
insert into public.verification_assignments (task_id, voter_id)
select t.id, v.id from public.verification_tasks t cross join (values ('a1600000-0000-0000-0000-000000000004'::uuid), ('a1600000-0000-0000-0000-000000000005'::uuid), ('a1600000-0000-0000-0000-000000000006'::uuid)) v(id)
where t.claim_code = 'event_official' and not t.is_test;
set local role service_role;
select throws_ok($$ select public.open_media_record_verification('a1600000-0000-0000-0000-000000000003', pg_temp.tid('event_official'), 'yes', '[]', true) $$, '42501', null, 'people can only answer tasks assigned to them');
select public.open_media_record_verification(v.id, pg_temp.tid('event_official'), 'yes', '[{"url":"https://example.com/yoga","quote":"Sunrise yoga, May 4"}]', true)
from (values ('a1600000-0000-0000-0000-000000000004'::uuid), ('a1600000-0000-0000-0000-000000000005'::uuid)) v(id);
select is(pg_temp.lstate('Sunrise yoga'), 'review', 'two answers are not enough');
select public.open_media_record_verification('a1600000-0000-0000-0000-000000000006', pg_temp.tid('event_official'), 'yes', '[{"url":"https://example.com/yoga","quote":"Sunrise yoga, May 4"}]', true);
select is(pg_temp.lstate('Sunrise yoga'), 'clear', 'three agreeing verified people with confirmed evidence clear the listing');
reset role;
set local role anon;
select is((public.open_media_public_post(pg_temp.lid('Sunrise yoga')) -> 'listing' ->> 'checkedBy')::int, 3, 'the listing shows how many people checked it');
select ok(public.open_media_listing_checks(pg_temp.lid('Sunrise yoga')) -> 'claims' -> 0 -> 'evidence' ? 'https://example.com/yoga', 'anyone can see what was checked and the cited pages');
select ok(jsonb_array_length(public.open_media_transparency(3)) = 3, 'anyone can read monthly transparency counts');

-- Large sellers confirm their details, or their sales pause
reset role;
set local role service_role;
select public.open_media_request_seller_disclosure('a1600000-0000-0000-0000-000000000001', '{"name":"Seller Studio LLC","address":"1 Main St, Springfield","email":"hi@seller.test"}');
reset role;
update public.seller_disclosures set requested_at = now() - interval '11 days' where user_id = 'a1600000-0000-0000-0000-000000000001';
select throws_ok($$
  insert into public.payment_intents (payer_id, recipient_id, amount_minor, currency, rail, provider, context_type, context_id, idempotency_key)
  values ('a1600000-0000-0000-0000-000000000003', 'a1600000-0000-0000-0000-000000000001', 12000, 'USD', 'card', 'stripe', 'listing', pg_temp.lid('Walnut lamp'), gen_random_uuid())
$$, '42501', null, 'sales pause when a large seller has not confirmed within 10 days');
insert into public.messages (conversation_id, sender_id, client_id, body)
values (app_private.notice_conversation('a1600000-0000-0000-0000-000000000001'), 'a1600000-0000-0000-0000-000000000001', gen_random_uuid(), 'Confirm');
set local role service_role;
select is(public.open_media_confirm_seller_replies(), 1, 'replying “confirm” confirms the details');
reset role;
select ok(not app_private.seller_paused('a1600000-0000-0000-0000-000000000001'), 'sales resume once confirmed');

select * from finish();
rollback;
