begin;

select plan(16);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'tuner@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated', 'auditor@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-0000000000f1', 'tuner', 'Tuner', ''), ('b2000000-0000-0000-0000-0000000000f2', 'auditor', 'Auditor', '');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000f1', true);

-- The database assigns versions, whatever number the client wrote.
select is((public.open_media_save_feed_lens('my-relevant', 'My Relevant', '{"name":"My Relevant","version":99,"boosts":[{"source":"hive","weight":-0.5}]}'::jsonb) ->> 'version')::integer, 1, 'a new lens starts at version 1');
select is((public.open_media_save_feed_lens('my-relevant', 'My Relevant', '{"name":"My Relevant","version":5,"boosts":[{"source":"hive","weight":-0.5}]}'::jsonb) ->> 'version')::integer, 1, 'saving the same manifest again is not a new version');
select set_config('test.lens', (public.open_media_save_feed_lens('my-relevant', 'My Relevant', '{"name":"My Relevant","boosts":[{"source":"hive","weight":-0.5},{"kind":"video","weight":0.5}]}'::jsonb, 'private', null, 'agent') ->> 'id'), true);
select is((select version from public.feed_lenses where id = current_setting('test.lens')::uuid), 2, 'a changed manifest is the next version');
select is((select manifest ->> 'version' from public.feed_lenses where id = current_setting('test.lens')::uuid), '2', 'the stored manifest carries the assigned version');
select is(jsonb_array_length(public.open_media_feed_lens_history('my-relevant')), 2, 'the person sees every version');
select is(public.open_media_feed_lens_history('my-relevant') -> 0 ->> 'changedBy', 'agent', 'the history says an agent made the change');
select is(public.open_media_feed_lens_history('my-relevant') -> 1 ->> 'changedBy', 'app', 'and that the person made the first one');
select throws_ok($$ select public.open_media_save_feed_lens('x', 'X', '{}'::jsonb, 'private', null, 'admin') $$, '22023', null, 'changed_by is app or agent only');

-- Going back is itself a new version, so it can be undone too.
select is((public.open_media_revert_feed_lens('my-relevant', 1) ->> 'version')::integer, 3, 'going back saves the old version as the newest');
select is((select jsonb_array_length(manifest -> 'boosts') from public.feed_lenses where id = current_setting('test.lens')::uuid), 1, 'with the old version''s rules');
select throws_ok($$ select public.open_media_revert_feed_lens('my-relevant', 42) $$, 'P0002', null, 'a version that was never kept cannot be restored');

-- Private versions stay private once the lens is shared; only shared versions can be audited.
select public.open_media_save_feed_lens('my-relevant', 'My Relevant', (select manifest from public.feed_lenses where id = current_setting('test.lens')::uuid), 'public');
select public.open_media_save_feed_lens('my-relevant', 'My Relevant', '{"name":"My Relevant","filters":{"mute":["crypto"]}}'::jsonb, 'public');
set local role anon;
select is(jsonb_array_length(public.open_media_public_feed_lens_history(current_setting('test.lens')::uuid)), 2, 'anyone can audit the versions made while it was shared');
select ok(not (public.open_media_public_feed_lens_history(current_setting('test.lens')::uuid) -> 0 ? 'visibility'), 'without internal fields');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000f2', true);
select is(jsonb_array_length(public.open_media_feed_lens_history('my-relevant')), 0, 'another person cannot read someone''s private history');
select is((select count(*) from public.feed_lens_versions)::integer, 0, 'the versions table shows only your own rows');
select throws_ok($$ insert into public.feed_lens_versions (lens_id, owner_id, version, name, manifest, visibility, changed_by) values (current_setting('test.lens')::uuid, 'b2000000-0000-0000-0000-0000000000f2', 9, 'X', '{}', 'private', 'app') $$, '42501', null, 'nobody writes versions directly');

select * from finish();
rollback;
