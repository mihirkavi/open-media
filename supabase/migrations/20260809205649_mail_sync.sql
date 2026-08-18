-- Timestamp matches the migration already applied to the production project.
create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  protocol text not null check (protocol in ('imap', 'pop3')),
  host text not null,
  port integer not null check (port between 1 and 65535),
  secure boolean not null default true check (secure = true),
  username text not null,
  encrypted_secret text not null,
  status text not null default 'connected' check (status in ('connected', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.mail_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references private.mail_accounts(id) on delete cascade,
  source_message_id text not null,
  mailbox text not null,
  subject text not null default '',
  sender text not null default '',
  recipients text[] not null default '{}',
  sent_at timestamptz not null,
  body_text text not null default '',
  search_vector tsvector generated always as (to_tsvector('simple', coalesce(subject,'') || ' ' || coalesce(sender,'') || ' ' || coalesce(body_text,''))) stored,
  created_at timestamptz not null default now(),
  unique (account_id, source_message_id)
);

create index mail_accounts_user_id_idx on private.mail_accounts(user_id);
create index mail_messages_user_id_sent_at_idx on private.mail_messages(user_id, sent_at desc);
create index mail_messages_search_idx on private.mail_messages using gin(search_vector);

alter table private.mail_accounts enable row level security;
alter table private.mail_messages enable row level security;

create policy "Users read their own mail accounts" on private.mail_accounts for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users delete their own mail accounts" on private.mail_accounts for delete to authenticated using ((select auth.uid()) = user_id);
create policy "Users read their own mail messages" on private.mail_messages for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users delete their own mail messages" on private.mail_messages for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on private.mail_accounts from anon, authenticated;
revoke all on private.mail_messages from anon, authenticated;

comment on column private.mail_accounts.encrypted_secret is 'AES-256-GCM ciphertext. Encryption key remains only in the mail-sync service.';
