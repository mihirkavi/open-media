-- ONDC stores (ADR 0015, phase 1). A seller in India opts in with one store: the address,
-- consumer-care contact and terms an ONDC catalog needs that a listing does not. Only the owner
-- reads or writes it through these functions; the Worker reads the catalog with the service key
-- to answer ONDC buyer apps. Nothing here takes orders yet.

create table if not exists public.ondc_stores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  store_name text not null default '' check (char_length(store_name) <= 80),
  category text not null default 'ONDC:RET16' check (category in ('ONDC:RET12', 'ONDC:RET13', 'ONDC:RET14', 'ONDC:RET15', 'ONDC:RET16')),
  building text not null default '' check (char_length(building) <= 120),
  locality text not null default '' check (char_length(locality) <= 120),
  city text not null default '' check (char_length(city) <= 60),
  state text not null default '' check (char_length(state) <= 60),
  area_code text not null default '' check (area_code = '' or area_code ~ '^[1-9][0-9]{5}$'),
  std_code text not null default '' check (std_code = '' or std_code ~ '^0[0-9]{2,4}$'),
  gps text not null default '' check (char_length(gps) <= 40),
  phone text not null default '' check (phone = '' or phone ~ '^[2-9][0-9]{9}$'),
  email text not null default '' check (char_length(email) <= 254),
  time_to_ship text not null default 'P3D' check (time_to_ship in ('PT24H', 'P2D', 'P3D', 'P5D', 'P7D')),
  returnable boolean not null default true,
  return_window text not null default 'P7D' check (return_window in ('P7D', 'P10D', 'P15D', 'P30D')),
  cancellable boolean not null default true,
  declaration_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ondc_stores_city_idx on public.ondc_stores (std_code, category) where enabled;

alter table public.ondc_stores enable row level security;
alter table public.ondc_stores force row level security;
revoke all on public.ondc_stores from public, anon, authenticated;
comment on table public.ondc_stores is 'ONDC seller stores (ADR 0015). Written only through open_media_set_ondc_store; read by the Worker through open_media_ondc_catalog.';

create or replace function app_private.ondc_store_json(p_store public.ondc_stores)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_store.id, 'enabled', p_store.enabled, 'storeName', p_store.store_name, 'category', p_store.category,
    'building', p_store.building, 'locality', p_store.locality, 'city', p_store.city, 'state', p_store.state,
    'areaCode', p_store.area_code, 'stdCode', p_store.std_code, 'gps', p_store.gps, 'phone', p_store.phone, 'email', p_store.email,
    'timeToShip', p_store.time_to_ship, 'returnable', p_store.returnable, 'returnWindow', p_store.return_window, 'cancellable', p_store.cancellable,
    'declarationAccepted', p_store.declaration_accepted_at is not null, 'updatedAt', p_store.updated_at
  );
$$;

/** Products that may go to ONDC: public, priced in INR, not sold out, from a store that is on. */
create or replace function app_private.ondc_item_json(p_post public.posts, p_listing public.post_listings)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_post.id, 'title', p_listing.title, 'body', p_post.body, 'priceMinor', p_listing.price_minor,
    'availability', p_listing.availability, 'createdAt', p_post.created_at, 'updatedAt', p_listing.updated_at, 'posterPath', p_post.video_poster_path
  );
$$;

create or replace function public.open_media_get_ondc_store()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.ondc_stores;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into v_store from public.ondc_stores where user_id = auth.uid();
  if not found then return null; end if;
  return app_private.ondc_store_json(v_store) || jsonb_build_object(
    'offeredItems', (select count(*) from public.posts p join public.post_listings l on l.post_id = p.id
      where p.author_id = auth.uid() and p.removed_at is null and l.kind = 'product' and l.currency = 'INR' and l.price_minor is not null and l.availability <> 'sold_out')
  );
end;
$$;

/** Saves the caller's store. The app validates first; this is the authority. */
create or replace function public.open_media_set_ondc_store(p_store jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean := coalesce((p_store ->> 'enabled')::boolean, false);
  v_declared boolean := coalesce((p_store ->> 'declarationAccepted')::boolean, false);
  v_gps text := btrim(coalesce(p_store ->> 'gps', ''));
  v_store public.ondc_stores;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_store is null or jsonb_typeof(p_store) <> 'object' then raise exception 'Send the store details.' using errcode = '22023'; end if;
  if v_enabled then
    if char_length(btrim(coalesce(p_store ->> 'storeName', ''))) < 2
      or char_length(btrim(coalesce(p_store ->> 'building', ''))) < 2
      or char_length(btrim(coalesce(p_store ->> 'locality', ''))) < 2
      or char_length(btrim(coalesce(p_store ->> 'city', ''))) < 2
      or char_length(btrim(coalesce(p_store ->> 'state', ''))) < 2
      or coalesce(p_store ->> 'areaCode', '') !~ '^[1-9][0-9]{5}$'
      or coalesce(p_store ->> 'stdCode', '') !~ '^0[0-9]{2,4}$'
      or coalesce(p_store ->> 'phone', '') !~ '^[2-9][0-9]{9}$'
      or coalesce(p_store ->> 'email', '') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
      or v_gps !~ '^[0-9]{1,2}(\.[0-9]{1,8})?,[0-9]{2,3}(\.[0-9]{1,8})?$'
      or split_part(v_gps, ',', 1)::numeric not between 6 and 38
      or split_part(v_gps, ',', 2)::numeric not between 68 and 98 then
      raise exception 'Fill in every store detail before turning the store on.' using errcode = '22023';
    end if;
    if not v_declared then raise exception 'Confirm the declaration before turning the store on.' using errcode = '22023'; end if;
    if not app_private.can_view_profile(null, auth.uid()) then
      raise exception 'Make your profile public first: ONDC buyers see the items on your public profile.' using errcode = '22023';
    end if;
  end if;
  insert into public.ondc_stores as s (user_id, enabled, store_name, category, building, locality, city, state, area_code, std_code, gps, phone, email,
    time_to_ship, returnable, return_window, cancellable, declaration_accepted_at, updated_at)
  values (auth.uid(), v_enabled, btrim(coalesce(p_store ->> 'storeName', '')), coalesce(p_store ->> 'category', 'ONDC:RET16'),
    btrim(coalesce(p_store ->> 'building', '')), btrim(coalesce(p_store ->> 'locality', '')), btrim(coalesce(p_store ->> 'city', '')), btrim(coalesce(p_store ->> 'state', '')),
    coalesce(p_store ->> 'areaCode', ''), coalesce(p_store ->> 'stdCode', ''), v_gps, coalesce(p_store ->> 'phone', ''), lower(btrim(coalesce(p_store ->> 'email', ''))),
    coalesce(p_store ->> 'timeToShip', 'P3D'), coalesce((p_store ->> 'returnable')::boolean, true), coalesce(p_store ->> 'returnWindow', 'P7D'),
    coalesce((p_store ->> 'cancellable')::boolean, true), case when v_declared then now() end, now())
  on conflict (user_id) do update set
    enabled = excluded.enabled, store_name = excluded.store_name, category = excluded.category, building = excluded.building, locality = excluded.locality,
    city = excluded.city, state = excluded.state, area_code = excluded.area_code, std_code = excluded.std_code, gps = excluded.gps, phone = excluded.phone,
    email = excluded.email, time_to_ship = excluded.time_to_ship, returnable = excluded.returnable, return_window = excluded.return_window,
    cancellable = excluded.cancellable, declaration_accepted_at = case when v_declared then coalesce(s.declaration_accepted_at, now()) end, updated_at = now()
  returning * into v_store;
  return app_private.ondc_store_json(v_store);
exception
  when check_violation or invalid_text_representation then raise exception 'Some store details are not valid.' using errcode = '22023';
end;
$$;

/**
 * The ONDC catalog for one city (STD code) and category: every store that is on, with its offered
 * products, optionally filtered by words in the item. Service role only.
 */
create or replace function public.open_media_ondc_catalog(p_std_code text, p_category text default null, p_query text default null, p_limit integer default 200)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(store.json order by store.updated_at desc), '[]'::jsonb)
  from (
    select app_private.ondc_store_json(s) || jsonb_build_object('handle', profile.handle, 'avatarUrl', profile.avatar_url, 'items', items.list) as json, s.updated_at
    from public.ondc_stores s
    join public.profiles profile on profile.id = s.user_id
    cross join lateral (
      select coalesce(jsonb_agg(item.json order by item.created_at desc), '[]'::jsonb) as list
      from (
        select app_private.ondc_item_json(p, l) as json, p.created_at
        from public.posts p join public.post_listings l on l.post_id = p.id
        where p.author_id = s.user_id and p.removed_at is null and l.kind = 'product' and l.currency = 'INR'
          and l.price_minor is not null and l.availability <> 'sold_out'
          and (nullif(btrim(p_query), '') is null or l.title ilike '%' || btrim(p_query) || '%' or p.body ilike '%' || btrim(p_query) || '%')
        order by p.created_at desc
        limit least(greatest(coalesce(p_limit, 200), 1), 500)
      ) item
    ) items
    where s.enabled and s.std_code = p_std_code and (p_category is null or s.category = p_category)
      and app_private.can_view_profile(null, s.user_id) and jsonb_array_length(items.list) > 0
  ) store;
$$;

/** Items a buyer app selected, with their store, for a quote. Service role only. */
create or replace function public.open_media_ondc_items(p_item_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app_private.ondc_item_json(p, l) || jsonb_build_object('storeId', s.id, 'store', app_private.ondc_store_json(s))), '[]'::jsonb)
  from public.posts p
  join public.post_listings l on l.post_id = p.id
  join public.ondc_stores s on s.user_id = p.author_id and s.enabled
  where p.id = any(p_item_ids) and p.removed_at is null and l.kind = 'product' and l.currency = 'INR' and l.price_minor is not null
    and app_private.can_view_profile(null, p.author_id);
$$;

revoke all on function app_private.ondc_store_json(public.ondc_stores) from public, anon, authenticated;
revoke all on function app_private.ondc_item_json(public.posts, public.post_listings) from public, anon, authenticated;
revoke all on function public.open_media_get_ondc_store() from public, anon;
grant execute on function public.open_media_get_ondc_store() to authenticated;
revoke all on function public.open_media_set_ondc_store(jsonb) from public, anon;
grant execute on function public.open_media_set_ondc_store(jsonb) to authenticated;
revoke all on function public.open_media_ondc_catalog(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.open_media_ondc_catalog(text, text, text, integer) to service_role;
revoke all on function public.open_media_ondc_items(uuid[]) from public, anon, authenticated;
grant execute on function public.open_media_ondc_items(uuid[]) to service_role;
