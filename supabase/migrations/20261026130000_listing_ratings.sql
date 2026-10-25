-- Ratings for products and services (ADR 0013, phase 4). Five stars, nothing else: no written
-- reviews, no replies, and never ratings of people. Only verified people who chose to show their
-- legal name (tier 5) can rate, which the database checks itself. One rating per person per item:
-- changing it replaces the old one, so edits never count twice. Every change is kept in a history
-- table for abuse review.

create table if not exists public.listing_ratings (
  listing_group_id uuid not null,
  rater_id uuid not null references auth.users(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (listing_group_id, rater_id)
);

create table if not exists public.listing_rating_history (
  id bigint generated always as identity primary key,
  listing_group_id uuid not null,
  rater_id uuid not null references auth.users(id) on delete cascade,
  stars smallint check (stars is null or stars between 1 and 5),
  recorded_at timestamptz not null default now()
);

create index if not exists listing_rating_history_group_idx on public.listing_rating_history (listing_group_id, recorded_at desc);

alter table public.listing_ratings enable row level security;
alter table public.listing_ratings force row level security;
alter table public.listing_rating_history enable row level security;
alter table public.listing_rating_history force row level security;
drop policy if exists "Raters read their ratings" on public.listing_ratings;
create policy "Raters read their ratings" on public.listing_ratings for select to authenticated using (rater_id = auth.uid());
revoke all on public.listing_ratings, public.listing_rating_history from public, anon, authenticated;
grant select on public.listing_ratings to authenticated;
comment on table public.listing_ratings is 'One 1–5 star rating per tier-5 person per listed item (ADR 0013). Written only through open_media_rate_listing.';
comment on table public.listing_rating_history is 'Every rating change, for abuse review. Not readable by clients.';

create or replace function app_private.rating_summary(p_group uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'average', round(avg(r.stars)::numeric, 1),
    'count', count(*),
    'mine', (select stars from public.listing_ratings where listing_group_id = p_group and rater_id = auth.uid())
  )
  from public.listing_ratings r where r.listing_group_id = p_group;
$$;

-- Listings now carry their rating.
create or replace function app_private.listing_json(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', l.kind, 'title', l.title, 'priceMinor', l.price_minor, 'currency', l.currency,
    'location', l.location_text, 'remote', l.remote, 'availability', l.availability, 'groupId', l.listing_group_id,
    'rating', app_private.rating_summary(l.listing_group_id)
  )
  from public.post_listings l where l.post_id = p_post_id;
$$;

create or replace function public.open_media_rate_listing(p_post_id uuid, p_stars integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_listing public.post_listings;
  v_profile public.profiles;
begin
  if v_user is null then raise exception 'Sign in to rate.' using errcode = '42501'; end if;
  select * into v_profile from public.profiles where id = v_user;
  if v_profile.id is null or app_private.identity_tier(v_profile) <> 5 then
    raise exception 'Only verified people who show their legal name can rate.' using errcode = '42501';
  end if;
  select * into v_listing from public.post_listings where post_id = p_post_id;
  if v_listing.post_id is null or exists (select 1 from public.posts where id = p_post_id and removed_at is not null) then
    raise exception 'Listing not found.' using errcode = 'P0002';
  end if;
  if v_listing.author_id = v_user then raise exception 'You cannot rate your own listing.' using errcode = '22023'; end if;
  if app_private.users_are_blocked(v_user, v_listing.author_id) then raise exception 'Listing not found.' using errcode = 'P0002'; end if;
  if p_stars is null or p_stars not between 1 and 5 then raise exception 'Choose 1 to 5 stars.' using errcode = '22023'; end if;
  if (select count(*) from public.listing_rating_history where rater_id = v_user and recorded_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many ratings. Try again later.' using errcode = '54000';
  end if;
  insert into public.listing_ratings as r (listing_group_id, rater_id, stars)
  values (v_listing.listing_group_id, v_user, p_stars)
  on conflict (listing_group_id, rater_id) do update set stars = excluded.stars, updated_at = now();
  insert into public.listing_rating_history (listing_group_id, rater_id, stars) values (v_listing.listing_group_id, v_user, p_stars);
  return app_private.rating_summary(v_listing.listing_group_id);
end;
$$;

create or replace function public.open_media_remove_rating(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select listing_group_id into v_group from public.post_listings where post_id = p_post_id;
  if v_group is null then raise exception 'Listing not found.' using errcode = 'P0002'; end if;
  delete from public.listing_ratings where listing_group_id = v_group and rater_id = auth.uid();
  if found then insert into public.listing_rating_history (listing_group_id, rater_id, stars) values (v_group, auth.uid(), null); end if;
  return app_private.rating_summary(v_group);
end;
$$;

revoke all on function app_private.rating_summary(uuid) from public, anon;
grant execute on function app_private.rating_summary(uuid) to authenticated;
revoke all on function public.open_media_rate_listing(uuid, integer) from public, anon;
revoke all on function public.open_media_remove_rating(uuid) from public, anon;
grant execute on function public.open_media_rate_listing(uuid, integer) to authenticated;
grant execute on function public.open_media_remove_rating(uuid) to authenticated;
