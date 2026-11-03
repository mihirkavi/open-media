-- Web feeds (ADR 0024): the RSS, Atom and JSON Feed addresses a person follows. Only the
-- subscription is stored; feed content is fetched and cached by the Worker, never kept here.
-- Row-level security is forced: people see, add, rename and remove only their own rows, and
-- anonymous visitors have no access at all.

create table if not exists public.web_feed_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  feed_url text not null check (feed_url ~ '^https://[^/\s]+\.[^/\s]+' and length(feed_url) <= 2048),
  title text not null check (length(btrim(title)) between 1 and 200),
  site_url text check (site_url is null or (site_url ~ '^https?://' and length(site_url) <= 2048)),
  icon_url text check (icon_url is null or (icon_url ~ '^https://' and length(icon_url) <= 2048)),
  created_at timestamptz not null default now(),
  unique (user_id, feed_url)
);

create index if not exists web_feed_subscriptions_user_idx on public.web_feed_subscriptions (user_id, created_at desc);

alter table public.web_feed_subscriptions enable row level security;
alter table public.web_feed_subscriptions force row level security;

drop policy if exists "People read their own web feeds" on public.web_feed_subscriptions;
create policy "People read their own web feeds" on public.web_feed_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "People follow web feeds for themselves" on public.web_feed_subscriptions;
create policy "People follow web feeds for themselves" on public.web_feed_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "People rename their own web feeds" on public.web_feed_subscriptions;
create policy "People rename their own web feeds" on public.web_feed_subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "People unfollow their own web feeds" on public.web_feed_subscriptions;
create policy "People unfollow their own web feeds" on public.web_feed_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.web_feed_subscriptions from public, anon, authenticated;
grant select, insert, delete on public.web_feed_subscriptions to authenticated;
grant update (title, site_url, icon_url) on public.web_feed_subscriptions to authenticated;

-- At most 300 feeds per person, so one account cannot make the Worker read thousands of sites.
create or replace function app_private.limit_web_feed_subscriptions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.web_feed_subscriptions where user_id = new.user_id) >= 300 then
    raise exception 'You can follow up to 300 web feeds. Unfollow some first.' using errcode = '54000';
  end if;
  return new;
end;
$$;
revoke all on function app_private.limit_web_feed_subscriptions() from public;

drop trigger if exists web_feed_subscriptions_limit on public.web_feed_subscriptions;
create trigger web_feed_subscriptions_limit before insert on public.web_feed_subscriptions
  for each row execute function app_private.limit_web_feed_subscriptions();

comment on table public.web_feed_subscriptions is 'Web feeds (RSS, Atom, JSON Feed) a person follows (ADR 0024). Owner-only under forced RLS; at most 300 per person.';
