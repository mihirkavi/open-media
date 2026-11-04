-- The topics a person chose for Relevant (ADR 0030 §4).
--
-- Until now these were kept on the device where they were typed, so the same account's Relevant
-- had topics on the laptop and none on the phone. They are the person's own explicit choices
-- (builder prompt §23, "selected interests"); nothing is inferred. At most 20 short words. Read and
-- written only by their owner, through the two functions below.

create table if not exists public.feed_interests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  interests text[] not null default '{}' check (cardinality(interests) <= 20),
  updated_at timestamptz not null default now()
);

alter table public.feed_interests enable row level security;
alter table public.feed_interests force row level security;

drop policy if exists "People read their own feed interests" on public.feed_interests;
create policy "People read their own feed interests" on public.feed_interests for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.feed_interests from public, anon, authenticated;
grant select on public.feed_interests to authenticated;

create or replace function public.open_media_my_feed_interests()
returns text[] language sql stable security definer set search_path = ''
as $$ select coalesce((select interests from public.feed_interests where user_id = auth.uid()), '{}'::text[]); $$;

-- Replaces the whole list. Words are lower-cased, trimmed, de-duplicated, 1–40 characters each.
create or replace function public.open_media_set_feed_interests(p_interests text[])
returns text[] language plpgsql security definer set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
  v_clean text[];
begin
  if v_viewer is null then raise exception 'Sign in to keep your topics.' using errcode = '42501'; end if;
  select coalesce(array_agg(word order by first_seen), '{}'::text[]) into v_clean
  from (
    select lower(btrim(item)) as word, min(position) as first_seen
    from unnest(coalesce(p_interests, '{}'::text[])) with ordinality as input(item, position)
    where char_length(btrim(item)) between 1 and 40
    group by lower(btrim(item))
    order by min(position)
    limit 20
  ) words;
  insert into public.feed_interests (user_id, interests, updated_at) values (v_viewer, v_clean, now())
  on conflict (user_id) do update set interests = excluded.interests, updated_at = excluded.updated_at;
  return v_clean;
end;
$$;

revoke all on function public.open_media_my_feed_interests() from public, anon;
revoke all on function public.open_media_set_feed_interests(text[]) from public, anon;
grant execute on function public.open_media_my_feed_interests() to authenticated;
grant execute on function public.open_media_set_feed_interests(text[]) to authenticated;

comment on table public.feed_interests is 'Topics a person chose for Relevant (ADR 0030). Written only through open_media_set_feed_interests.';
