-- Open Media AI (ADR 0028): one private AI conversation per person, the AI provider keys they
-- bring, and which model answers. Keys are encrypted by the Worker with a key the database never
-- sees; only the ciphertext and the last four characters are stored here. Row-level security is
-- forced on every table: people see and change only their own rows, and anonymous visitors have
-- no access at all.

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  body text not null check (length(body) between 1 and 20000),
  source text not null default 'chat' check (source in ('chat', 'search')),
  provider text check (provider is null or provider ~ '^[a-z-]{2,20}$'),
  model text check (model is null or length(model) <= 120),
  meta jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 8000),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists ai_messages_user_idx on public.ai_messages (user_id, created_at desc);

alter table public.ai_messages enable row level security;
alter table public.ai_messages force row level security;

drop policy if exists "People read their own AI chat" on public.ai_messages;
create policy "People read their own AI chat" on public.ai_messages for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "People add to their own AI chat" on public.ai_messages;
create policy "People add to their own AI chat" on public.ai_messages for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "People clear their own AI chat" on public.ai_messages;
create policy "People clear their own AI chat" on public.ai_messages for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.ai_messages from public, anon, authenticated;
grant select, insert, delete on public.ai_messages to authenticated;

create table if not exists public.ai_provider_keys (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic', 'google', 'openrouter', 'groq', 'mistral', 'deepseek', 'xai')),
  ciphertext text not null check (length(ciphertext) between 20 and 2000),
  hint text not null check (hint ~ '^[A-Za-z0-9_-]{4}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, provider)
);

alter table public.ai_provider_keys enable row level security;
alter table public.ai_provider_keys force row level security;

drop policy if exists "People read their own AI keys" on public.ai_provider_keys;
create policy "People read their own AI keys" on public.ai_provider_keys for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "People add their own AI keys" on public.ai_provider_keys;
create policy "People add their own AI keys" on public.ai_provider_keys for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "People replace their own AI keys" on public.ai_provider_keys;
create policy "People replace their own AI keys" on public.ai_provider_keys for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "People remove their own AI keys" on public.ai_provider_keys;
create policy "People remove their own AI keys" on public.ai_provider_keys for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.ai_provider_keys from public, anon, authenticated;
grant select, insert, delete on public.ai_provider_keys to authenticated;
-- Saving a key again replaces it (an upsert, which also names the row's own user_id and provider;
-- the policies keep both pinned to the person).
grant update (user_id, provider, ciphertext, hint, created_at) on public.ai_provider_keys to authenticated;

create table if not exists public.ai_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  provider text check (provider is null or provider in ('built-in', 'openai', 'anthropic', 'google', 'openrouter', 'groq', 'mistral', 'deepseek', 'xai')),
  model text check (model is null or model ~ '^[A-Za-z0-9._:/@-]{2,80}$'),
  updated_at timestamptz not null default now()
);

alter table public.ai_settings enable row level security;
alter table public.ai_settings force row level security;

drop policy if exists "People read their own AI settings" on public.ai_settings;
create policy "People read their own AI settings" on public.ai_settings for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "People create their own AI settings" on public.ai_settings;
create policy "People create their own AI settings" on public.ai_settings for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "People change their own AI settings" on public.ai_settings;
create policy "People change their own AI settings" on public.ai_settings for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.ai_settings from public, anon, authenticated;
grant select, insert on public.ai_settings to authenticated;
grant update (user_id, provider, model, updated_at) on public.ai_settings to authenticated;

-- At most 5,000 AI messages per person; the oldest go first, so the chat never stops working.
create or replace function app_private.trim_ai_messages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.ai_messages
  where user_id = new.user_id
    and id in (select id from public.ai_messages where user_id = new.user_id order by created_at desc offset 5000);
  return null;
end;
$$;
revoke all on function app_private.trim_ai_messages() from public;

drop trigger if exists ai_messages_trim on public.ai_messages;
create trigger ai_messages_trim after insert on public.ai_messages
  for each row execute function app_private.trim_ai_messages();

comment on table public.ai_messages is 'Open Media AI chat and AI search history (ADR 0028). Owner-only under forced RLS; newest 5,000 kept.';
comment on table public.ai_provider_keys is 'AI provider API keys a person brought (ADR 0028), encrypted by the Worker. Owner-only under forced RLS.';
comment on table public.ai_settings is 'Which AI model answers in a person''s AI chat (ADR 0028). Owner-only under forced RLS.';
