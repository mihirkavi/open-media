begin;

select plan(4);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('c3000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'maker@example.test', '', now(), now(), now());
insert into public.profiles (id, handle, display_name, bio) values ('c3000000-0000-0000-0000-0000000000f1', 'maker', 'Maker', '');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c3000000-0000-0000-0000-0000000000f1', true);

select is(
  public.open_media_set_professional_profile('{"headline":"Designer","projects":[{"name":"Ledger design system","url":"https://example.com/ledger","description":"Tokens and components."},{"name":"Sketchbook"}]}') -> 'projects' -> 0 ->> 'name',
  'Ledger design system', 'a person saves projects from their portfolio');
select is(public.open_media_public_profile('maker') -> 'professional' -> 'projects' -> 1 ->> 'name', 'Sketchbook', 'projects show on the public profile');
select throws_ok($$ select public.open_media_set_professional_profile('{"projects":[{"name":"Old blog","url":"http://example.com"}]}') $$, '22023', null, 'project links must be https');
select throws_ok($$ select public.open_media_set_professional_profile('{"projects":[{"name":"X","secret":"y"}]}') $$, '22023', null, 'projects carry only a name, link and description');

select * from finish();
rollback;
