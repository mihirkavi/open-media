begin;

select plan(9);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', 'owner@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated', 'friend@example.test', '', now(), now(), now()),
  ('c3000000-0000-0000-0000-0000000000d3', 'authenticated', 'authenticated', 'stranger@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-0000000000d1', 'fieldowner', 'Owner', ''), ('b2000000-0000-0000-0000-0000000000d2', 'fieldfriend', 'Friend', ''), ('c3000000-0000-0000-0000-0000000000d3', 'fieldstranger', 'Stranger', '');
-- Owner and friend follow each other (public accounts, so follows are accepted at once).
insert into public.follows (follower_id, followee_id, status) values
  ('a1000000-0000-0000-0000-0000000000d1', 'b2000000-0000-0000-0000-0000000000d2', 'accepted'),
  ('b2000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000d1', 'accepted');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000d1', true);
select is(jsonb_array_length(public.open_media_set_profile_fields('[
  {"field":"linkedin","value":"owner","visibility":"everyone"},
  {"field":"phone","value":"+91 98765 43210","visibility":"connections"},
  {"field":"email","value":"owner@example.com","visibility":"only_me"},
  {"field":"x","value":"   ","visibility":"everyone"}
]')), 3, 'the owner saves fields; empty ones are dropped');
select is(jsonb_array_length(public.open_media_public_profile('fieldowner') -> 'fields'), 3, 'the owner sees every field');
select throws_ok($$ select public.open_media_set_profile_fields('[{"field":"phone","value":"1","visibility":"friends"}]') $$, '22023', null, 'unknown visibilities are refused');
select throws_ok($$ insert into public.profile_fields (user_id, field, value, visibility) values (auth.uid(), 'x', 'me', 'everyone') $$, '42501', null, 'fields cannot be written directly');

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000d2', true);
select is((select array_agg(item ->> 'field' order by item ->> 'field') from jsonb_array_elements(public.open_media_public_profile('fieldowner') -> 'fields') item), array['linkedin', 'phone'], 'a connection sees everyone and connections fields');
select is((select count(*)::int from public.profile_fields), 0, 'and cannot read the table');

select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000d3', true);
select is((select array_agg(item ->> 'field') from jsonb_array_elements(public.open_media_public_profile('fieldowner') -> 'fields') item), array['linkedin'], 'a stranger sees only everyone fields');

reset role;
set local role anon;
select is((select array_agg(item ->> 'field') from jsonb_array_elements(public.open_media_public_profile('fieldowner') -> 'fields') item), array['linkedin'], 'signed out sees only everyone fields');
reset role;

-- Mutual follows make a connection (a shared conversation does too, through shares_conversation).
select ok(app_private.is_connection('a1000000-0000-0000-0000-0000000000d1', 'b2000000-0000-0000-0000-0000000000d2'), 'mutual follows are connections');

select * from finish();
rollback;
