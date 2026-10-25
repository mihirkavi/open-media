-- Creator payments (ADR 0013, phase 6): tips and one-time paid posts, on the same payment intents
-- as listings. A tip is an amount the payer chooses, for a creator who turned tips on. A paid post
-- has a public preview (an ordinary post) and a part only its author and the people whose payment
-- was confirmed can read; a refund takes access away again. Nothing here moves money by itself.

-- ─── Tips ────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists tips_enabled boolean not null default false;
comment on column public.profiles.tips_enabled is 'Whether this person accepts tips on their posts (ADR 0013, phase 6).';

create or replace function public.open_media_set_tips_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  update public.profiles set tips_enabled = coalesce(p_enabled, false) where id = auth.uid();
  if not found then raise exception 'Finish setting up your profile first.' using errcode = 'P0002'; end if;
  return coalesce(p_enabled, false);
end;
$$;

-- ─── Paid posts ──────────────────────────────────────────────────────────────

create table if not exists public.paid_posts (
  post_id uuid primary key references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  price_minor bigint not null check (price_minor between 50 and 100000000),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  paid_body text not null check (char_length(btrim(paid_body)) between 1 and 10000),
  created_at timestamptz not null default now()
);

create index if not exists paid_posts_author_idx on public.paid_posts (author_id, created_at desc);
alter table public.paid_posts enable row level security;
alter table public.paid_posts force row level security;
drop policy if exists "Authors read their paid posts" on public.paid_posts;
create policy "Authors read their paid posts" on public.paid_posts for select to authenticated using (author_id = auth.uid());
revoke all on public.paid_posts from public, anon, authenticated;
grant select on public.paid_posts to authenticated;
comment on table public.paid_posts is 'The paid part of a post and its price. Readable by the author and, through app_private.paid_json, by people whose payment was confirmed.';

create or replace function app_private.has_paid_for(p_user uuid, p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from public.payment_intents i
    where i.payer_id = p_user and i.context_type = 'paid_post' and i.context_id = p_post_id and i.status = 'confirmed'
  );
$$;

-- What a viewer sees of a paid post: the price always, the paid part only when unlocked.
create or replace function app_private.paid_json(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'priceMinor', p.price_minor,
    'currency', p.currency,
    'unlocked', p.author_id = auth.uid() or app_private.has_paid_for(auth.uid(), p.post_id),
    'body', case when p.author_id = auth.uid() or app_private.has_paid_for(auth.uid(), p.post_id) then p.paid_body end
  )
  from public.paid_posts p where p.post_id = p_post_id;
$$;

-- Public posts now say whether the author takes tips and carry the paid part's price (and, for
-- people who unlocked it, the paid part itself).
create or replace function app_private.public_post_json(p_post public.posts, p_profile public.profiles)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_post.id,
    'body', p_post.body,
    'createdAt', p_post.created_at,
    'author', jsonb_build_object(
      'id', p_profile.id,
      'handle', p_profile.handle,
      'displayName', app_private.shown_name(p_profile),
      'avatarUrl', p_profile.avatar_url,
      'verified', app_private.is_verified(p_profile.id),
      'tipsEnabled', p_profile.tips_enabled
    ),
    'video', case when p_post.video_path is null then null else jsonb_build_object(
      'path', p_post.video_path,
      'posterPath', p_post.video_poster_path,
      'durationSeconds', p_post.video_duration_seconds,
      'width', p_post.video_width,
      'height', p_post.video_height,
      'contentType', p_post.video_content_type,
      'sha256', p_post.video_sha256
    ) end,
    'listing', app_private.listing_json(p_post.id),
    'paid', app_private.paid_json(p_post.id)
  );
$$;

create or replace function public.open_media_create_paid_post(p_client_id uuid, p_preview text, p_paid_body text, p_price_minor bigint, p_currency text default 'USD')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post jsonb;
  v_post_id uuid;
begin
  if auth.uid() is null then raise exception 'A valid Open Media session is required.' using errcode = '42501'; end if;
  if btrim(coalesce(p_preview, '')) = '' then raise exception 'Write a public preview so people know what they are paying for.' using errcode = '22023'; end if;
  if btrim(coalesce(p_paid_body, '')) = '' or char_length(p_paid_body) > 10000 then raise exception 'The paid part needs 1 to 10,000 characters.' using errcode = '22023'; end if;
  if p_price_minor is null or p_price_minor not between 50 and 100000000 then raise exception 'Set a price of at least 0.50.' using errcode = '22023'; end if;
  v_post := app_private.create_post(p_client_id, p_preview, null);
  v_post_id := (v_post ->> 'id')::uuid;
  begin
    insert into public.paid_posts (post_id, author_id, price_minor, currency, paid_body)
    values (v_post_id, auth.uid(), p_price_minor, coalesce(upper(p_currency), 'USD'), p_paid_body)
    on conflict (post_id) do nothing;
  exception when check_violation then
    raise exception 'Check the price and its 3-letter currency.' using errcode = '22023';
  end;
  return v_post || jsonb_build_object('paid', app_private.paid_json(v_post_id));
end;
$$;

create or replace function public.open_media_paid_post_content(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.paid_json(p_post_id) where auth.uid() is not null;
$$;

-- ─── Paying for posts ────────────────────────────────────────────────────────

-- How a post can be paid for (tip or unlock), so the app shows only what works.
create or replace function public.open_media_post_payment_options(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'card', exists (select 1 from public.payment_accounts a where a.user_id = post.author_id and a.charges_enabled),
    'chains', coalesce((select jsonb_agg(distinct w.chain) from public.payment_wallets w where w.user_id = post.author_id), '[]'::jsonb),
    'tipsEnabled', profile.tips_enabled,
    'paid', app_private.paid_json(post.id),
    'fees', (select jsonb_object_agg(f.context_type, f.platform_fee_bps) from public.payment_fees f)
  )
  from public.posts post join public.profiles profile on profile.id = post.author_id
  where post.id = p_post_id and post.removed_at is null and auth.uid() is not null and post.author_id <> auth.uid()
    and app_private.can_view_profile(auth.uid(), post.author_id) and not app_private.users_are_blocked(auth.uid(), post.author_id);
$$;

-- Payments now cover tips and paid posts. Tips are the one amount a payer chooses (1 to 500 US
-- dollars); everything else still comes from the database.
drop function if exists public.open_media_create_payment_intent(uuid, text, uuid, text, text);
create or replace function public.open_media_create_payment_intent(
  p_idempotency_key uuid, p_context_type text, p_context_id uuid, p_rail text, p_chain text default null, p_amount_minor bigint default null
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
  v_paid public.paid_posts;
  v_post public.posts;
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
  elsif p_context_type in ('tip', 'paid_post') then
    select * into v_post from public.posts where id = p_context_id and removed_at is null;
    if v_post.id is null or not app_private.can_view_profile(v_user, v_post.author_id) or app_private.users_are_blocked(v_user, v_post.author_id) then
      raise exception 'Post not found.' using errcode = 'P0002';
    end if;
    v_recipient := v_post.author_id;
    if p_context_type = 'tip' then
      if not exists (select 1 from public.profiles where id = v_post.author_id and tips_enabled) then raise exception 'This creator does not take tips.' using errcode = '22023'; end if;
      if p_amount_minor is null or p_amount_minor not between 100 and 50000 then raise exception 'Choose a tip from 1 to 500 US dollars.' using errcode = '22023'; end if;
      v_amount := p_amount_minor;
      v_currency := 'USD';
    else
      select * into v_paid from public.paid_posts where post_id = p_context_id;
      if v_paid.post_id is null then raise exception 'This post is free.' using errcode = '22023'; end if;
      if app_private.has_paid_for(v_user, p_context_id) then raise exception 'You already unlocked this post.' using errcode = '22023'; end if;
      v_amount := v_paid.price_minor;
      v_currency := v_paid.currency;
    end if;
  else
    raise exception 'Payments for this are not available.' using errcode = '22023';
  end if;
  if v_recipient = v_user then raise exception 'You cannot pay yourself.' using errcode = '22023'; end if;

  select platform_fee_bps into v_fee_bps from public.payment_fees where context_type = p_context_type;
  if p_rail = 'card' then
    if not exists (select 1 from public.payment_accounts where user_id = v_recipient and charges_enabled) then
      raise exception 'This person does not accept card payments yet.' using errcode = '22023';
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
    if v_address is null then raise exception 'This person has no wallet for USDC on this network.' using errcode = '22023'; end if;
    insert into public.payment_intents (payer_id, recipient_id, amount_minor, currency, rail, provider, context_type, context_id, platform_fee_minor, recipient_address, idempotency_key)
    values (v_user, v_recipient, v_amount * 10000, 'USDC', 'onchain', p_chain, p_context_type, p_context_id, 0, v_address, p_idempotency_key)
    returning * into v_intent;
  end if;
  insert into public.payment_events (intent_id, status, source) values (v_intent.id, 'created', 'payer');
  return app_private.payment_json(v_intent);
end;
$$;

-- Payments and checkout pages name what was paid for.
create or replace function app_private.payment_title(p_context_type text, p_context_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_context_type
    when 'listing' then (select title from public.post_listings where post_id = p_context_id)
    when 'tip' then 'Tip for @' || (select pr.handle from public.posts po join public.profiles pr on pr.id = po.author_id where po.id = p_context_id)
    when 'paid_post' then 'Post by @' || (select pr.handle from public.posts po join public.profiles pr on pr.id = po.author_id where po.id = p_context_id)
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
    'context', jsonb_build_object('type', p_intent.context_type, 'id', p_intent.context_id, 'title', app_private.payment_title(p_intent.context_type, p_intent.context_id)),
    'platformFeeMinor', p_intent.platform_fee_minor, 'providerFeeEstimateMinor', p_intent.provider_fee_estimate_minor,
    'status', p_intent.status,
    'recipientAddress', p_intent.recipient_address,
    'txHash', p_intent.tx_hash,
    'createdAt', p_intent.created_at, 'confirmedAt', p_intent.confirmed_at,
    'events', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'source', e.source, 'at', e.recorded_at) order by e.id) from public.payment_events e where e.intent_id = p_intent.id), '[]'::jsonb)
  );
$$;

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
    'title', coalesce(app_private.payment_title(i.context_type, i.context_id), 'Open Media payment')
  )
  from public.payment_intents i where i.id = p_intent_id and i.rail = 'card';
$$;

revoke all on function public.open_media_set_tips_enabled(boolean) from public, anon;
grant execute on function public.open_media_set_tips_enabled(boolean) to authenticated;
revoke all on function app_private.has_paid_for(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.paid_json(uuid) from public, anon;
grant execute on function app_private.paid_json(uuid) to authenticated;
revoke all on function app_private.payment_title(text, uuid) from public, anon, authenticated;
revoke all on function public.open_media_create_paid_post(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.open_media_create_paid_post(uuid, text, text, bigint, text) to authenticated;
revoke all on function public.open_media_paid_post_content(uuid) from public, anon;
grant execute on function public.open_media_paid_post_content(uuid) to authenticated;
revoke all on function public.open_media_post_payment_options(uuid) from public, anon;
grant execute on function public.open_media_post_payment_options(uuid) to authenticated;
revoke all on function public.open_media_create_payment_intent(uuid, text, uuid, text, text, bigint) from public, anon;
grant execute on function public.open_media_create_payment_intent(uuid, text, uuid, text, text, bigint) to authenticated;

-- Payment settings now include whether the person takes tips.
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
    'fees', (select jsonb_object_agg(f.context_type, f.platform_fee_bps) from public.payment_fees f),
    'tipsEnabled', coalesce((select p.tips_enabled from public.profiles p where p.id = auth.uid()), false)
  )
  where auth.uid() is not null;
$$;
