-- Payment foundations (ADR 0013, phase 5). Open Media never holds money: card payments go
-- through Stripe Connect straight to the seller's Stripe account, and USDC goes from the payer's
-- wallet straight to the seller's wallet. These tables record what was asked for and what the
-- providers proved. A payment's status moves forward only through server functions fed by
-- Stripe's signed webhooks or by the Worker reading the chain; clients can never mark a payment
-- confirmed. Nothing here moves live money: the Worker refuses live Stripe keys and Base mainnet
-- until the operator turns them on.

-- ─── Fees (one place, shown before every approval) ───────────────────────────

create table if not exists public.payment_fees (
  context_type text primary key check (context_type in ('listing', 'tip', 'paid_post')),
  platform_fee_bps integer not null default 0 check (platform_fee_bps between 0 and 3000),
  updated_at timestamptz not null default now()
);

insert into public.payment_fees (context_type, platform_fee_bps)
values ('listing', 0), ('tip', 0), ('paid_post', 0)
on conflict (context_type) do nothing;

alter table public.payment_fees enable row level security;
alter table public.payment_fees force row level security;
drop policy if exists "Anyone reads fees" on public.payment_fees;
create policy "Anyone reads fees" on public.payment_fees for select to anon, authenticated using (true);
revoke all on public.payment_fees from public, anon, authenticated;
grant select on public.payment_fees to anon, authenticated;
comment on table public.payment_fees is 'Open Media''s fee per kind of payment, in basis points (0 for now). Card payments only: on-chain payments go wallet to wallet with no Open Media fee.';

-- ─── Where people receive money ──────────────────────────────────────────────

create table if not exists public.payment_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_account_id text not null unique check (stripe_account_id ~ '^acct_[A-Za-z0-9]{6,64}$'),
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  livemode boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.payment_accounts enable row level security;
alter table public.payment_accounts force row level security;
drop policy if exists "Owners read their payment account" on public.payment_accounts;
create policy "Owners read their payment account" on public.payment_accounts for select to authenticated using (user_id = auth.uid());
revoke all on public.payment_accounts from public, anon, authenticated;
grant select on public.payment_accounts to authenticated;
comment on table public.payment_accounts is 'A person''s Stripe Connect Express account for receiving card payments. Written only by the server from Stripe.';

create table if not exists public.payment_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chain text not null check (chain in ('base', 'base-sepolia')),
  -- Lowercase hex. Linked only after the Worker checked a signature from this address.
  address text not null check (address ~ '^0x[0-9a-f]{40}$'),
  verified_at timestamptz not null default now(),
  unique (chain, address)
);

create index if not exists payment_wallets_user_idx on public.payment_wallets (user_id);
alter table public.payment_wallets enable row level security;
alter table public.payment_wallets force row level security;
drop policy if exists "Owners read their wallets" on public.payment_wallets;
create policy "Owners read their wallets" on public.payment_wallets for select to authenticated using (user_id = auth.uid());
revoke all on public.payment_wallets from public, anon, authenticated;
grant select on public.payment_wallets to authenticated;
comment on table public.payment_wallets is 'External wallets a person proved they control (signed message). Never shown on profiles; a recipient address is copied only onto the payments sent to it.';

-- ─── Payments ────────────────────────────────────────────────────────────────

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  payer_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  -- Cents for card payments; USDC base units (6 decimals) on-chain.
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3,5}$'),
  rail text not null check (rail in ('card', 'onchain')),
  provider text not null check (provider in ('stripe', 'base', 'base-sepolia')),
  context_type text not null check (context_type in ('listing', 'tip', 'paid_post')),
  context_id uuid not null,
  platform_fee_minor bigint not null default 0 check (platform_fee_minor >= 0),
  provider_fee_estimate_minor bigint check (provider_fee_estimate_minor is null or provider_fee_estimate_minor >= 0),
  status text not null default 'created' check (status in ('created', 'awaiting_payer', 'submitted', 'confirmed', 'failed', 'refunded')),
  provider_reference text check (provider_reference is null or char_length(provider_reference) between 1 and 200),
  recipient_address text check (recipient_address is null or recipient_address ~ '^0x[0-9a-f]{40}$'),
  tx_hash text unique check (tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$'),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (payer_id, idempotency_key),
  check (payer_id <> recipient_id),
  check ((rail = 'card') = (provider = 'stripe')),
  check (rail = 'card' or recipient_address is not null),
  check (rail = 'onchain' or platform_fee_minor < amount_minor)
);

create index if not exists payment_intents_payer_idx on public.payment_intents (payer_id, created_at desc);
create index if not exists payment_intents_recipient_idx on public.payment_intents (recipient_id, created_at desc);
create index if not exists payment_intents_context_idx on public.payment_intents (context_type, context_id);
create unique index if not exists payment_intents_reference_idx on public.payment_intents (provider, provider_reference) where provider_reference is not null;

create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  intent_id uuid not null references public.payment_intents(id) on delete cascade,
  status text not null check (status in ('created', 'awaiting_payer', 'submitted', 'confirmed', 'failed', 'refunded')),
  source text not null check (source in ('payer', 'stripe_webhook', 'chain', 'server')),
  evidence jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now()
);

create index if not exists payment_events_intent_idx on public.payment_events (intent_id, id);

alter table public.payment_intents enable row level security;
alter table public.payment_intents force row level security;
alter table public.payment_events enable row level security;
alter table public.payment_events force row level security;
drop policy if exists "Parties read their payments" on public.payment_intents;
create policy "Parties read their payments" on public.payment_intents for select to authenticated using (payer_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists "Parties read their payment events" on public.payment_events;
create policy "Parties read their payment events" on public.payment_events for select to authenticated
  using (exists (select 1 from public.payment_intents i where i.id = intent_id and (i.payer_id = auth.uid() or i.recipient_id = auth.uid())));
revoke all on public.payment_intents, public.payment_events from public, anon, authenticated;
grant select on public.payment_intents, public.payment_events to authenticated;
comment on table public.payment_intents is 'One payment from one person to another (ADR 0013). Created through open_media_create_payment_intent; status advances only from server-verified evidence.';
comment on table public.payment_events is 'Append-only history of each payment, with the evidence that moved it.';

-- ─── Helpers ─────────────────────────────────────────────────────────────────

-- Which status may follow which. Confirmation and refunds need provider evidence.
create or replace function app_private.payment_transition_allowed(p_from text, p_to text, p_source text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_to = 'confirmed' then p_from in ('created', 'awaiting_payer', 'submitted') and p_source in ('stripe_webhook', 'chain')
    when p_to = 'refunded' then p_from = 'confirmed' and p_source = 'stripe_webhook'
    when p_to = 'failed' then p_from in ('created', 'awaiting_payer', 'submitted') and p_source in ('stripe_webhook', 'chain', 'server')
    when p_to = 'awaiting_payer' then p_from = 'created' and p_source = 'server'
    when p_to = 'submitted' then p_from in ('created', 'awaiting_payer') and p_source in ('payer', 'server')
    else false
  end;
$$;

create or replace function app_private.payment_json(p_intent public.payment_intents)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_intent.id,
    'direction', case when p_intent.payer_id = auth.uid() then 'sent' else 'received' end,
    'payer', (select handle from public.profiles where id = p_intent.payer_id),
    'recipient', (select handle from public.profiles where id = p_intent.recipient_id),
    'amountMinor', p_intent.amount_minor, 'currency', p_intent.currency,
    'rail', p_intent.rail, 'provider', p_intent.provider,
    'context', jsonb_build_object('type', p_intent.context_type, 'id', p_intent.context_id,
      'title', case when p_intent.context_type = 'listing' then (select title from public.post_listings where post_id = p_intent.context_id) end),
    'platformFeeMinor', p_intent.platform_fee_minor, 'providerFeeEstimateMinor', p_intent.provider_fee_estimate_minor,
    'status', p_intent.status,
    'recipientAddress', p_intent.recipient_address,
    'txHash', p_intent.tx_hash,
    'createdAt', p_intent.created_at, 'confirmedAt', p_intent.confirmed_at,
    'events', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'source', e.source, 'at', e.recorded_at) order by e.id) from public.payment_events e where e.intent_id = p_intent.id), '[]'::jsonb)
  );
$$;

-- ─── Creating a payment (the payer) ──────────────────────────────────────────

-- The recipient, amount and currency always come from what is being paid for, never from the
-- client. Card payments need the recipient's Stripe account to accept charges; on-chain payments
-- need a verified wallet on that chain and a price in US dollars (paid in USDC).
create or replace function public.open_media_create_payment_intent(
  p_idempotency_key uuid, p_context_type text, p_context_id uuid, p_rail text, p_chain text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.payment_intents;
  v_listing public.post_listings;
  v_recipient uuid;
  v_amount bigint;
  v_currency text;
  v_fee_bps integer;
  v_address text;
  v_intent public.payment_intents;
begin
  if v_user is null then raise exception 'Sign in to pay.' using errcode = '42501'; end if;
  if p_idempotency_key is null then raise exception 'Missing idempotency key.' using errcode = '22023'; end if;
  select * into v_existing from public.payment_intents where payer_id = v_user and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then return app_private.payment_json(v_existing); end if;
  if p_rail not in ('card', 'onchain') then raise exception 'Choose card or onchain.' using errcode = '22023'; end if;
  if p_rail = 'onchain' and coalesce(p_chain, '') not in ('base', 'base-sepolia') then raise exception 'Choose base or base-sepolia.' using errcode = '22023'; end if;
  if (select count(*) from public.payment_intents where payer_id = v_user and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many payments started. Try again later.' using errcode = '54000';
  end if;

  if p_context_type = 'listing' then
    select * into v_listing from public.post_listings where post_id = p_context_id;
    if v_listing.post_id is null or exists (select 1 from public.posts where id = p_context_id and removed_at is not null)
       or not app_private.can_view_profile(v_user, v_listing.author_id) or app_private.users_are_blocked(v_user, v_listing.author_id) then
      raise exception 'Listing not found.' using errcode = 'P0002';
    end if;
    if v_listing.price_minor is null or v_listing.price_minor = 0 then raise exception 'This listing has no price. Message the seller instead.' using errcode = '22023'; end if;
    if v_listing.availability = 'sold_out' then raise exception 'This listing is sold out.' using errcode = '22023'; end if;
    v_recipient := v_listing.author_id;
    v_amount := v_listing.price_minor;
    v_currency := v_listing.currency;
  else
    raise exception 'Payments for this are not available yet.' using errcode = '22023';
  end if;
  if v_recipient = v_user then raise exception 'You cannot pay yourself.' using errcode = '22023'; end if;

  select platform_fee_bps into v_fee_bps from public.payment_fees where context_type = p_context_type;
  if p_rail = 'card' then
    if not exists (select 1 from public.payment_accounts where user_id = v_recipient and charges_enabled) then
      raise exception 'This seller does not accept card payments yet.' using errcode = '22023';
    end if;
    insert into public.payment_intents (payer_id, recipient_id, amount_minor, currency, rail, provider, context_type, context_id, platform_fee_minor, provider_fee_estimate_minor, idempotency_key)
    values (v_user, v_recipient, v_amount, v_currency, 'card', 'stripe', p_context_type, p_context_id,
      (v_amount * coalesce(v_fee_bps, 0)) / 10000,
      -- Stripe's standard US card fee (2.9% + 30¢), shown as an estimate only.
      case when v_currency = 'USD' then ceil(v_amount * 0.029)::bigint + 30 end,
      p_idempotency_key)
    returning * into v_intent;
  else
    if v_currency <> 'USD' then raise exception 'USDC payments need a price in US dollars.' using errcode = '22023'; end if;
    select address into v_address from public.payment_wallets where user_id = v_recipient and chain = p_chain order by verified_at desc limit 1;
    if v_address is null then raise exception 'This seller has no wallet for USDC on this network.' using errcode = '22023'; end if;
    insert into public.payment_intents (payer_id, recipient_id, amount_minor, currency, rail, provider, context_type, context_id, platform_fee_minor, recipient_address, idempotency_key)
    values (v_user, v_recipient, v_amount * 10000, 'USDC', 'onchain', p_chain, p_context_type, p_context_id, 0, v_address, p_idempotency_key)
    returning * into v_intent;
  end if;
  insert into public.payment_events (intent_id, status, source) values (v_intent.id, 'created', 'payer');
  return app_private.payment_json(v_intent);
end;
$$;

-- The payer says which transaction paid; the Worker then checks it on the chain. The same
-- transaction can never pay twice.
create or replace function public.open_media_submit_onchain_payment(p_intent_id uuid, p_tx_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.payment_intents;
  v_hash text := lower(btrim(p_tx_hash));
begin
  select * into v_intent from public.payment_intents where id = p_intent_id and payer_id = auth.uid() for update;
  if v_intent.id is null then raise exception 'Payment not found.' using errcode = 'P0002'; end if;
  if v_intent.rail <> 'onchain' then raise exception 'Only on-chain payments take a transaction.' using errcode = '22023'; end if;
  if v_hash !~ '^0x[0-9a-f]{64}$' then raise exception 'That is not a transaction hash.' using errcode = '22023'; end if;
  if v_intent.status = 'submitted' and v_intent.tx_hash = v_hash then return app_private.payment_json(v_intent); end if;
  if not app_private.payment_transition_allowed(v_intent.status, 'submitted', 'payer') then
    raise exception 'This payment can no longer change.' using errcode = '22023';
  end if;
  if exists (select 1 from public.payment_intents where tx_hash = v_hash) then raise exception 'That transaction already paid for something else.' using errcode = '23505'; end if;
  update public.payment_intents set status = 'submitted', tx_hash = v_hash, updated_at = now() where id = v_intent.id returning * into v_intent;
  insert into public.payment_events (intent_id, status, source, evidence) values (v_intent.id, 'submitted', 'payer', jsonb_build_object('txHash', v_hash));
  return app_private.payment_json(v_intent);
end;
$$;

create or replace function public.open_media_my_payments(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app_private.payment_json(i) order by i.created_at desc), '[]'::jsonb)
  from (
    select * from public.payment_intents
    where payer_id = auth.uid() or recipient_id = auth.uid()
    order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) i;
$$;

create or replace function public.open_media_payment(p_intent_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.payment_json(i) from public.payment_intents i
  where i.id = p_intent_id and (i.payer_id = auth.uid() or i.recipient_id = auth.uid());
$$;

-- What the signed-in person has set up for receiving money.
create or replace function public.open_media_payment_setup()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'card', (select jsonb_build_object('chargesEnabled', a.charges_enabled, 'payoutsEnabled', a.payouts_enabled, 'detailsSubmitted', a.details_submitted, 'livemode', a.livemode)
             from public.payment_accounts a where a.user_id = auth.uid()),
    'wallets', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'chain', w.chain, 'address', w.address, 'verifiedAt', w.verified_at) order by w.verified_at desc)
                         from public.payment_wallets w where w.user_id = auth.uid()), '[]'::jsonb),
    'fees', (select jsonb_object_agg(f.context_type, f.platform_fee_bps) from public.payment_fees f)
  )
  where auth.uid() is not null;
$$;

create or replace function public.open_media_remove_wallet(p_wallet_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  delete from public.payment_wallets where id = p_wallet_id and user_id = auth.uid();
  if not found then raise exception 'Wallet not found.' using errcode = 'P0002'; end if;
end;
$$;

-- How a listing can be paid for, so the app shows only the choices that work.
create or replace function public.open_media_listing_payment_options(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'card', exists (select 1 from public.payment_accounts a where a.user_id = l.author_id and a.charges_enabled),
    'chains', coalesce((select jsonb_agg(distinct w.chain) from public.payment_wallets w where w.user_id = l.author_id), '[]'::jsonb),
    'priceMinor', l.price_minor, 'currency', l.currency, 'available', l.availability <> 'sold_out',
    'platformFeeBps', (select platform_fee_bps from public.payment_fees where context_type = 'listing')
  )
  from public.post_listings l
  where l.post_id = p_post_id and auth.uid() is not null and l.author_id <> auth.uid()
    and app_private.can_view_profile(auth.uid(), l.author_id) and not app_private.users_are_blocked(auth.uid(), l.author_id);
$$;

-- ─── Server-only (service role): provider evidence ───────────────────────────

create or replace function public.open_media_record_payment_event(
  p_intent_id uuid, p_status text, p_source text, p_provider_reference text default null, p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.payment_intents;
begin
  select * into v_intent from public.payment_intents where id = p_intent_id for update;
  if v_intent.id is null then raise exception 'payment not found' using errcode = 'P0002'; end if;
  -- Providers retry webhooks; recording the same status twice changes nothing, except that a
  -- payer who reopens checkout gets a new Stripe session in place of the expired one.
  if v_intent.status = p_status then
    if p_status = 'awaiting_payer' and p_provider_reference is not null and p_provider_reference is distinct from v_intent.provider_reference then
      update public.payment_intents set provider_reference = p_provider_reference, updated_at = now() where id = v_intent.id;
      return jsonb_build_object('id', v_intent.id, 'status', v_intent.status, 'changed', true);
    end if;
    return jsonb_build_object('id', v_intent.id, 'status', v_intent.status, 'changed', false);
  end if;
  if not app_private.payment_transition_allowed(v_intent.status, p_status, p_source) then
    raise exception 'payment cannot move from % to % (%)', v_intent.status, p_status, p_source using errcode = '22023';
  end if;
  update public.payment_intents set
    status = p_status,
    provider_reference = coalesce(p_provider_reference, provider_reference),
    confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
    updated_at = now()
  where id = v_intent.id returning * into v_intent;
  insert into public.payment_events (intent_id, status, source, evidence) values (v_intent.id, p_status, p_source, coalesce(p_evidence, '{}'::jsonb));
  if p_status = 'confirmed' and v_intent.context_type = 'listing' then
    update public.post_listings set updated_at = now() where post_id = v_intent.context_id;
  end if;
  return jsonb_build_object('id', v_intent.id, 'status', v_intent.status, 'changed', true);
end;
$$;

create or replace function public.open_media_set_payment_account(
  p_user uuid, p_stripe_account_id text, p_charges_enabled boolean, p_payouts_enabled boolean, p_details_submitted boolean, p_livemode boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.payment_accounts as a (user_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted, livemode, updated_at)
  values (p_user, p_stripe_account_id, coalesce(p_charges_enabled, false), coalesce(p_payouts_enabled, false), coalesce(p_details_submitted, false), coalesce(p_livemode, false), now())
  on conflict (user_id) do update set
    stripe_account_id = excluded.stripe_account_id, charges_enabled = excluded.charges_enabled, payouts_enabled = excluded.payouts_enabled,
    details_submitted = excluded.details_submitted, livemode = excluded.livemode, updated_at = now();
end;
$$;

create or replace function public.open_media_add_wallet(p_user uuid, p_chain text, p_address text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_address text := lower(btrim(p_address));
  v_wallet public.payment_wallets;
begin
  if exists (select 1 from public.payment_wallets where chain = p_chain and address = v_address and user_id <> p_user) then
    raise exception 'This wallet is linked to another account.' using errcode = '23505';
  end if;
  if (select count(*) from public.payment_wallets where user_id = p_user) >= 5 then
    raise exception 'Remove a wallet before adding another (up to 5).' using errcode = '54000';
  end if;
  insert into public.payment_wallets as w (user_id, chain, address) values (p_user, p_chain, v_address)
  on conflict (chain, address) do update set verified_at = now()
  returning * into v_wallet;
  return jsonb_build_object('id', v_wallet.id, 'chain', v_wallet.chain, 'address', v_wallet.address, 'verifiedAt', v_wallet.verified_at);
end;
$$;

-- What the Worker needs to check an on-chain payment: the intent and the payer's own wallets.
create or replace function public.open_media_onchain_payment_check(p_intent_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'payerId', i.payer_id, 'status', i.status, 'chain', i.provider, 'amountMinor', i.amount_minor,
    'recipientAddress', i.recipient_address, 'txHash', i.tx_hash, 'createdAt', i.created_at,
    'payerAddresses', coalesce((select jsonb_agg(w.address) from public.payment_wallets w where w.user_id = i.payer_id and w.chain = i.provider), '[]'::jsonb)
  )
  from public.payment_intents i where i.id = p_intent_id and i.rail = 'onchain';
$$;

-- The Worker attaches the Stripe Checkout session it created and waits for the payer.
create or replace function public.open_media_card_payment_details(p_intent_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'payerId', i.payer_id, 'status', i.status, 'amountMinor', i.amount_minor, 'currency', i.currency,
    'platformFeeMinor', i.platform_fee_minor, 'providerReference', i.provider_reference,
    'stripeAccountId', (select a.stripe_account_id from public.payment_accounts a where a.user_id = i.recipient_id and a.charges_enabled),
    'title', case when i.context_type = 'listing' then (select l.title from public.post_listings l where l.post_id = i.context_id) else i.context_type end
  )
  from public.payment_intents i where i.id = p_intent_id and i.rail = 'card';
$$;

revoke all on function app_private.payment_transition_allowed(text, text, text) from public, anon, authenticated;
revoke all on function app_private.payment_json(public.payment_intents) from public, anon;
grant execute on function app_private.payment_json(public.payment_intents) to authenticated;

revoke all on function public.open_media_create_payment_intent(uuid, text, uuid, text, text) from public, anon;
revoke all on function public.open_media_submit_onchain_payment(uuid, text) from public, anon;
revoke all on function public.open_media_my_payments(integer) from public, anon;
revoke all on function public.open_media_payment(uuid) from public, anon;
revoke all on function public.open_media_payment_setup() from public, anon;
revoke all on function public.open_media_remove_wallet(uuid) from public, anon;
revoke all on function public.open_media_listing_payment_options(uuid) from public, anon;
grant execute on function public.open_media_create_payment_intent(uuid, text, uuid, text, text) to authenticated;
grant execute on function public.open_media_submit_onchain_payment(uuid, text) to authenticated;
grant execute on function public.open_media_my_payments(integer) to authenticated;
grant execute on function public.open_media_payment(uuid) to authenticated;
grant execute on function public.open_media_payment_setup() to authenticated;
grant execute on function public.open_media_remove_wallet(uuid) to authenticated;
grant execute on function public.open_media_listing_payment_options(uuid) to authenticated;

revoke all on function public.open_media_record_payment_event(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.open_media_set_payment_account(uuid, text, boolean, boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public.open_media_add_wallet(uuid, text, text) from public, anon, authenticated;
revoke all on function public.open_media_onchain_payment_check(uuid) from public, anon, authenticated;
revoke all on function public.open_media_card_payment_details(uuid) from public, anon, authenticated;
grant execute on function public.open_media_record_payment_event(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.open_media_set_payment_account(uuid, text, boolean, boolean, boolean, boolean) to service_role;
grant execute on function public.open_media_add_wallet(uuid, text, text) to service_role;
grant execute on function public.open_media_onchain_payment_check(uuid) to service_role;
grant execute on function public.open_media_card_payment_details(uuid) to service_role;
