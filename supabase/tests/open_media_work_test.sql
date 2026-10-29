begin;

select plan(12);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'employer@example.test', '', now(), now(), now()),
  ('b2000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated', 'seeker@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio)
values ('a1000000-0000-0000-0000-0000000000e1', 'employer', 'Employer', ''), ('b2000000-0000-0000-0000-0000000000e2', 'seeker', 'Seeker', '');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000e2', true);

-- Professional profiles
select is(
  public.open_media_set_professional_profile('{"headline":"Product designer","openTo":"work","work":[{"name":"Acme","position":"Designer","highlights":[]}],"skills":["Figma"],"links":[{"label":"Site","url":"https://example.com"}]}') ->> 'headline',
  'Product designer', 'a person saves their professional profile');
select is(public.open_media_public_profile('seeker') -> 'professional' ->> 'openTo', 'work', 'the public profile shows it');
select throws_ok($$ select public.open_media_set_professional_profile('{"birthDate":"1990-01-01"}') $$, '22023', null, 'unknown fields such as a birth date are refused');
select throws_ok($$ select public.open_media_set_professional_profile('{"links":[{"label":"x","url":"http://example.com"}]}') $$, '22023', null, 'links must be https');
select throws_ok($$ update public.profiles set professional = '{"headline":"x"}' where id = auth.uid() $$, '42501', null, 'the column cannot be written directly');

-- Jobs
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000e1', true);
select is(
  public.open_media_create_listing_post('d4000000-0000-0000-0000-0000000000e4', '', '{"kind":"job","title":"Data analyst","priceMinor":120000000,"currency":"INR","job":{"employmentType":"full_time","payMaxMinor":180000000,"applyUrl":"https://jobs.example.com/analyst"}}') -> 'listing' -> 'job' ->> 'applyUrl',
  'https://jobs.example.com/analyst', 'an employer posts a job with a pay range above the sale-price ceiling');
select is(public.open_media_public_posts(5, null, null, 'employer', null) -> 0 -> 'listing' -> 'job' ->> 'employmentType', 'full_time', 'the feed shows the job details');
select throws_ok($$ select public.open_media_create_listing_post(gen_random_uuid(), '', '{"kind":"job","title":"Role","job":{"applyUrl":"javascript:alert(1)"}}') $$, '22023', null, 'apply links must be https');
select throws_ok($$ select public.open_media_create_listing_post(gen_random_uuid(), '', '{"kind":"job","title":"Role","priceMinor":5000,"job":{"payMaxMinor":4000}}') $$, '22023', null, 'the top of the range cannot be below the bottom');
select throws_ok($$ select public.open_media_create_listing_post(gen_random_uuid(), '', '{"kind":"product","title":"Bike","priceMinor":120000000}') $$, '22023', null, 'products keep the sale-price ceiling');

-- The Work lens id is reserved
select throws_ok($$ insert into public.feed_lenses (owner_id, lens_key, name, manifest) values (auth.uid(), 'work', 'Work', '{}') $$, '42501', null, 'lenses cannot be written directly');
reset role;
select throws_ok($$ insert into public.feed_lenses (owner_id, lens_key, name, manifest) values ('a1000000-0000-0000-0000-0000000000e1', 'work', 'Work', '{}') $$, '23514', null, 'no saved lens can take the Work id');

select * from finish();
rollback;
