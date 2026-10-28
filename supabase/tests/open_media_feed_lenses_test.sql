begin;

select plan(12);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'maker@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated', 'reader@example.test', '', now(), now(), now()),
  ('c3000000-0000-0000-0000-0000000000e3', 'authenticated', 'authenticated', 'hidden@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-0000000000e1', 'maker', 'Maker', ''), ('b2000000-0000-0000-0000-0000000000e2', 'reader', 'Reader', ''), ('c3000000-0000-0000-0000-0000000000e3', 'hidden', 'Hidden', '');
update public.profiles set visibility = 'private' where id = 'c3000000-0000-0000-0000-0000000000e3';

set local role anon;
select throws_ok($$ select public.open_media_save_feed_lens('calm', 'Calm', '{}'::jsonb) $$, '42501', null, 'signed-out people cannot save a lens');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000e1', true);
select throws_ok($$ select public.open_media_save_feed_lens('raw', 'Raw', '{}'::jsonb) $$, '23514', null, 'the built-in ids are reserved');
select throws_ok($$ select public.open_media_save_feed_lens('calm', 'Calm', '[]'::jsonb) $$, '23514', null, 'a manifest must be an object');
select set_config('test.lens', (public.open_media_save_feed_lens('calm-videos', 'Calm videos', '{"format":"open-media.feed-lens/1","name":"Calm videos","filters":{"kinds":["video"]}}'::jsonb, 'public') ->> 'id'), true);
select is((public.open_media_my_feed_lenses() -> 0 ->> 'key'), 'calm-videos', 'the maker sees their lens');
select is((public.open_media_save_feed_lens('calm-videos', 'Calm clips', '{"name":"Calm clips"}'::jsonb, 'public') ->> 'id'), current_setting('test.lens'), 'saving the same key updates it in place');
select set_config('test.private', (public.open_media_save_feed_lens('notes', 'Notes', '{"name":"Notes"}'::jsonb) ->> 'id'), true);

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000e2', true);
select is(jsonb_array_length(public.open_media_my_feed_lenses()), 0, 'another person cannot read someone else''s lenses');
select is((select count(*) from public.feed_lenses)::integer, 0, 'the table shows only your own rows');
select public.open_media_save_feed_lens('calm-copy', 'Calm clips', '{"name":"Calm clips"}'::jsonb, 'private', current_setting('test.lens')::uuid);
select throws_ok($$ select public.open_media_save_feed_lens('sneak', 'Sneak', '{}'::jsonb, 'private', current_setting('test.private')::uuid) $$, '22023', null, 'only shared lenses can be forked');

set local role anon;
select is(jsonb_array_length(public.open_media_public_feed_lenses(null, 30)), 1, 'only public lenses are listed');
select is((public.open_media_public_feed_lens(current_setting('test.lens')::uuid) ->> 'installs')::integer, 1, 'a copy by someone else counts as an install');
select is((public.open_media_public_feed_lens(current_setting('test.lens')::uuid) -> 'author' ->> 'handle'), 'maker', 'a public account is named as the author');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000e3', true);
select set_config('test.hidden', (public.open_media_save_feed_lens('quiet', 'Quiet', '{"name":"Quiet"}'::jsonb, 'public') ->> 'id'), true);
set local role anon;
select ok((public.open_media_public_feed_lens(current_setting('test.hidden')::uuid) -> 'author') = 'null'::jsonb, 'a private account shares without being named');

select * from finish();
rollback;
