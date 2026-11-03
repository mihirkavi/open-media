begin;

select plan(11);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('c3000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'reader@example.test', '', now(), now(), now()),
  ('d4000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'other@example.test', '', now(), now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000a1', true);

insert into public.web_feed_subscriptions (feed_url, title, site_url) values ('https://feeds.bbci.co.uk/news/rss.xml', 'BBC News', 'https://www.bbc.co.uk/news');
select is((select user_id from public.web_feed_subscriptions limit 1), 'c3000000-0000-0000-0000-0000000000a1'::uuid, 'a new feed belongs to the person who followed it');
select throws_ok($$ insert into public.web_feed_subscriptions (feed_url, title) values ('https://feeds.bbci.co.uk/news/rss.xml', 'Again') $$, '23505', null, 'the same feed cannot be followed twice');
select throws_ok($$ insert into public.web_feed_subscriptions (feed_url, title) values ('http://example.com/feed', 'Plain http') $$, '23514', null, 'only https feeds');
select throws_ok($$ insert into public.web_feed_subscriptions (feed_url, title) values ('https://example.com/feed', '   ') $$, '23514', null, 'a feed needs a title');
select throws_ok($$ insert into public.web_feed_subscriptions (user_id, feed_url, title) values ('d4000000-0000-0000-0000-0000000000a2', 'https://example.com/feed', 'For someone else') $$, '42501', null, 'nobody can follow a feed for someone else');
select throws_ok($$ update public.web_feed_subscriptions set feed_url = 'https://evil.example/feed' $$, '42501', null, 'the address of a followed feed cannot be changed, only removed');

select set_config('request.jwt.claim.sub', 'd4000000-0000-0000-0000-0000000000a2', true);
select is((select count(*) from public.web_feed_subscriptions)::integer, 0, 'another person cannot see someone''s feeds');
delete from public.web_feed_subscriptions;
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000a1', true);
select is((select count(*) from public.web_feed_subscriptions)::integer, 1, 'or remove them');

insert into public.web_feed_subscriptions (feed_url, title) select 'https://example.com/feed/' || n, 'Feed ' || n from generate_series(1, 299) as n;
select throws_ok($$ insert into public.web_feed_subscriptions (feed_url, title) values ('https://example.com/one-too-many', 'One too many') $$, '54000', null, 'at most 300 feeds per person');

set local role anon;
select throws_ok($$ select count(*) from public.web_feed_subscriptions $$, '42501', null, 'anonymous visitors have no access');

set local role authenticated;
delete from public.web_feed_subscriptions where feed_url = 'https://feeds.bbci.co.uk/news/rss.xml';
select is((select count(*) from public.web_feed_subscriptions where feed_url = 'https://feeds.bbci.co.uk/news/rss.xml')::integer, 0, 'unfollowing removes the row');

select * from finish();
rollback;
