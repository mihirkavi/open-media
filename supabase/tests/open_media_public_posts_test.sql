begin;

select plan(27);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice@example.test', '', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bob@example.test', '', now(), now(), now()),
  ('30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'carol@example.test', '', now(), now(), now()),
  ('50000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'dave@example.test', '', now(), now(), now()),
  ('60000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'noprofile@example.test', '', now(), now(), now());

insert into public.profiles (id, handle, display_name, bio)
values
  ('10000000-0000-0000-0000-000000000001', 'alice', 'Alice', 'Hello from Alice'),
  ('20000000-0000-0000-0000-000000000002', 'bob', 'Bob', ''),
  ('30000000-0000-0000-0000-000000000003', 'carol', 'Carol', ''),
  ('50000000-0000-0000-0000-000000000005', 'dave', 'Dave', '');

-- Authoring
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$ select public.open_media_create_post('a0000000-0000-0000-0000-000000000001', '  First public post  ') $$,
  'a profile can publish a post'
);
select is(
  (public.open_media_create_post('a0000000-0000-0000-0000-000000000001', 'First public post'))->>'id',
  (select id::text from public.posts where client_id = 'a0000000-0000-0000-0000-000000000001'),
  'repeated publishes with the same client ID are idempotent'
);
select is((select count(*) from public.posts), 1::bigint, 'an author reads their own post row');
select is((select body from public.posts limit 1), 'First public post', 'post text is trimmed');
select throws_ok(
  $$ select public.open_media_create_post(gen_random_uuid(), '   ') $$,
  '22023', null, 'empty posts are rejected'
);
select throws_ok(
  $$ select public.open_media_create_post(gen_random_uuid(), repeat('x', 2001)) $$,
  '22023', null, 'posts over 2000 characters are rejected'
);
select throws_ok(
  $$ insert into public.posts (author_id, client_id, body) values ('10000000-0000-0000-0000-000000000001', gen_random_uuid(), 'direct') $$,
  '42501', null, 'direct post inserts bypassing validation are denied'
);
select lives_ok(
  $$ select public.open_media_create_post(gen_random_uuid(), 'Second post') $$,
  'an author can publish again'
);

select set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000006', true);
select throws_ok(
  $$ select public.open_media_create_post(gen_random_uuid(), 'no profile') $$,
  '42501', null, 'an account without a profile cannot publish'
);

-- Anonymous public reading
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select is(jsonb_array_length(public.open_media_public_posts()), 2, 'signed-out visitors can read public posts');
select is(public.open_media_public_posts()->0->>'body', 'Second post', 'public posts are newest first');
select is(
  public.open_media_public_posts()->0->'author'->>'handle', 'alice',
  'public posts include the author handle'
);
select ok(
  not (public.open_media_public_posts()->0 ? 'client_id') and not (public.open_media_public_posts()->0->'author' ? 'email'),
  'public posts expose no client IDs or email addresses'
);
select is(
  jsonb_array_length(public.open_media_public_posts(
    1,
    (public.open_media_public_posts(1)->0->>'createdAt')::timestamptz,
    (public.open_media_public_posts(1)->0->>'id')::uuid
  )),
  1,
  'keyset pagination returns the next page'
);
select is(public.open_media_public_profile('ALICE')->>'bio', 'Hello from Alice', 'signed-out visitors can read a public profile');
select is((public.open_media_public_profile('alice')->>'postCount')::int, 2, 'public profiles report their visible post count');
select is(public.open_media_public_profile('nobody'), null::jsonb, 'unknown handles return null');
select throws_ok($$ select count(*) from public.posts $$, '42501', null, 'anonymous callers cannot read the posts table directly');
select throws_ok($$ select count(*) from public.messages $$, '42501', null, 'anonymous callers still cannot read messages');
select throws_ok(
  $$ select public.open_media_create_post(gen_random_uuid(), 'anon') $$,
  '42501', null, 'anonymous callers cannot publish'
);

-- Reporting and community moderation
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$ select public.open_media_report_post((select id from public.posts where body = 'Second post'), 'spam', '') $$,
  '22023', null, 'authors cannot report their own post'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$ select public.open_media_report_post((public.open_media_public_posts(1)->0->>'id')::uuid, 'spam', 'ads') $$,
  'a signed-in person can report a post'
);
select lives_ok(
  $$ select public.open_media_report_post((public.open_media_public_posts(1)->0->>'id')::uuid, 'spam', 'ads again') $$,
  'repeated reports from one person are idempotent'
);
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true);
select public.open_media_report_post((public.open_media_public_posts(1)->0->>'id')::uuid, 'harassment', '');
select is(jsonb_array_length(public.open_media_public_posts()), 2, 'two distinct reports do not hide a post');
select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000005', true);
select public.open_media_report_post((public.open_media_public_posts(1)->0->>'id')::uuid, 'spam', '');
select is(jsonb_array_length(public.open_media_public_posts()), 1, 'the third distinct report hides the post from everyone');

-- Blocks hide authors from a signed-in viewer's feed
select public.open_media_set_user_blocked('10000000-0000-0000-0000-000000000001', true);
select is(jsonb_array_length(public.open_media_public_posts()), 0, 'a viewer does not see posts from people they blocked');

-- Deletion
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$ select public.open_media_delete_post((select id from public.posts where body = 'First public post')) $$,
  'an author can delete their own post'
);

select * from finish();
rollback;
