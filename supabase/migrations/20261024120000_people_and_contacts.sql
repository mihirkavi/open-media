-- ADR 0013, phase 1: unified profiles and contacts.
--
-- 1. Profile owners can list their accounts on open networks. These are public, owner-declared
--    links (not proof of ownership) used to build the person's unified timeline.
-- 2. Contact cards: each person's private address book, synced across their devices. The Worker
--    encrypts every card before it reaches this table, and only the card's owner can read or
--    write it. Nothing public (functions, the public API, search) reads this table.

create or replace function app_private.valid_linked_accounts(p_accounts jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_accounts) = 'array'
    and jsonb_array_length(p_accounts) <= 8
    and not exists (
      select 1 from jsonb_array_elements(p_accounts) item
      where jsonb_typeof(item) <> 'object'
        or (item->>'network') is null
        or (item->>'network') not in ('farcaster', 'lens', 'hive', 'deso')
        or (item->>'handle') is null
        or (item->>'handle') !~ '^[A-Za-z0-9._-]{1,64}$'
    );
$$;

alter table public.profiles
  add column if not exists linked_accounts jsonb not null default '[]'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_linked_accounts_valid;
alter table public.profiles
  add constraint profiles_linked_accounts_valid check (app_private.valid_linked_accounts(linked_accounts));

create or replace function public.open_media_public_profile(p_handle text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', profile.id,
    'handle', profile.handle,
    'displayName', profile.display_name,
    'bio', profile.bio,
    'avatarUrl', profile.avatar_url,
    'joinedAt', profile.created_at,
    'linkedAccounts', profile.linked_accounts,
    'postCount', (
      select count(*) from public.posts post
      where post.author_id = profile.id and post.removed_at is null
    )
  )
  from public.profiles profile
  where profile.handle = lower(p_handle);
$$;

revoke all on function public.open_media_public_profile(text) from public;
grant execute on function public.open_media_public_profile(text) to anon, authenticated;
revoke all on function app_private.valid_linked_accounts(jsonb) from public, anon;
grant execute on function app_private.valid_linked_accounts(jsonb) to authenticated;

create table if not exists public.contact_cards (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- AES-256-GCM ciphertext produced by the Worker; never plaintext.
  ciphertext text not null check (char_length(ciphertext) between 16 and 65536 and ciphertext ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  updated_at timestamptz not null default now()
);

create index if not exists contact_cards_owner_idx on public.contact_cards (owner_id, updated_at desc);

alter table public.contact_cards enable row level security;
alter table public.contact_cards force row level security;

drop policy if exists "Owners read their contact cards" on public.contact_cards;
drop policy if exists "Owners add their contact cards" on public.contact_cards;
drop policy if exists "Owners change their contact cards" on public.contact_cards;
drop policy if exists "Owners delete their contact cards" on public.contact_cards;
create policy "Owners read their contact cards" on public.contact_cards for select to authenticated using (owner_id = auth.uid());
create policy "Owners add their contact cards" on public.contact_cards for insert to authenticated with check (owner_id = auth.uid());
create policy "Owners change their contact cards" on public.contact_cards for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Owners delete their contact cards" on public.contact_cards for delete to authenticated using (owner_id = auth.uid());

revoke all on public.contact_cards from public, anon;
grant select, insert, update, delete on public.contact_cards to authenticated;

comment on table public.contact_cards is 'Each person''s own contact cards, encrypted by the Worker (ADR 0013). Owner-only; never read by public functions.';
