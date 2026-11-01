-- Professional projects (ADR 0020): filling a profile from a portfolio website proposes the things
-- the person made, so the professional profile gains an optional `projects` list in JSON Resume's
-- shape: up to 10 entries, each with a name, an optional https link and an optional description.
-- Everything else about valid_professional is unchanged (ADR 0018); src/domain/professionalProfile.ts
-- checks the same rules in the app and the Worker.

create or replace function app_private.valid_professional(p jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
    and not exists (select 1 from jsonb_object_keys(p) key where key not in ('headline', 'summary', 'openTo', 'location', 'work', 'education', 'skills', 'languages', 'links', 'projects'))
    and (not p ? 'headline' or (jsonb_typeof(p -> 'headline') = 'string' and char_length(p ->> 'headline') <= 120))
    and (not p ? 'summary' or (jsonb_typeof(p -> 'summary') = 'string' and char_length(p ->> 'summary') <= 1200))
    and (not p ? 'location' or (jsonb_typeof(p -> 'location') = 'string' and char_length(p ->> 'location') <= 120))
    and (not p ? 'openTo' or p ->> 'openTo' in ('work', 'hiring'))
    and (not p ? 'work' or (jsonb_typeof(p -> 'work') = 'array' and jsonb_array_length(p -> 'work') <= 20
      and not exists (select 1 from jsonb_array_elements(p -> 'work') item where jsonb_typeof(item) <> 'object' or coalesce(item ->> 'name', '') = '' or coalesce(item ->> 'position', '') = '')))
    and (not p ? 'education' or (jsonb_typeof(p -> 'education') = 'array' and jsonb_array_length(p -> 'education') <= 10
      and not exists (select 1 from jsonb_array_elements(p -> 'education') item where jsonb_typeof(item) <> 'object' or coalesce(item ->> 'institution', '') = '')))
    and (not p ? 'skills' or (jsonb_typeof(p -> 'skills') = 'array' and jsonb_array_length(p -> 'skills') <= 50))
    and (not p ? 'languages' or (jsonb_typeof(p -> 'languages') = 'array' and jsonb_array_length(p -> 'languages') <= 10))
    and (not p ? 'links' or (jsonb_typeof(p -> 'links') = 'array' and jsonb_array_length(p -> 'links') <= 8
      and not exists (select 1 from jsonb_array_elements(p -> 'links') item where coalesce(item ->> 'url', '') !~ '^https://')))
    and (not p ? 'projects' or (jsonb_typeof(p -> 'projects') = 'array' and jsonb_array_length(p -> 'projects') <= 10
      and not exists (select 1 from jsonb_array_elements(p -> 'projects') item
        where jsonb_typeof(item) <> 'object'
          or coalesce(item ->> 'name', '') = '' or char_length(item ->> 'name') > 120
          or (item ? 'url' and coalesce(item ->> 'url', '') !~ '^https://')
          or char_length(coalesce(item ->> 'description', '')) > 600
          or exists (select 1 from jsonb_object_keys(item) key where key not in ('name', 'url', 'description')))));
$$;
revoke all on function app_private.valid_professional(jsonb) from public, anon, authenticated;
