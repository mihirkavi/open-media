begin;

select plan(7);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'topics-one@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated', 'topics-two@example.test', '', now(), now(), now());

set local role anon;
select throws_ok($$ select public.open_media_set_feed_interests(array['design']) $$, '42501', null, 'signed-out people cannot keep topics');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f1', true);
select is(public.open_media_my_feed_interests(), '{}'::text[], 'nobody starts with topics');
select is(public.open_media_set_feed_interests(array[' Design ', 'design', 'AI', '', repeat('x', 41)]), array['design', 'ai'], 'topics are trimmed, lower-cased, de-duplicated, and empty or long words dropped, in the order given');
select is(cardinality(public.open_media_set_feed_interests(array(select 'topic' || n from generate_series(1, 30) n))), 20, 'at most 20 topics are kept');
select is(public.open_media_set_feed_interests(array['climbing']), array['climbing'], 'saving replaces the whole list');

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000f2', true);
select is(public.open_media_my_feed_interests(), '{}'::text[], 'another person cannot read someone else''s topics');
select is((select count(*) from public.feed_interests)::integer, 0, 'the table shows only your own row');

select * from finish();
rollback;
