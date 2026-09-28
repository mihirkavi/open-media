-- Public Open Media posts, post reporting, and anonymous read access.
--
-- Every post is public: anyone, including signed-out visitors and automated
-- agents, can read it through the security-definer read functions below.
-- Messages, mailboxes, blocks, and reports stay private. Anonymous callers get
-- no direct table access; they only receive the explicit public projection.

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removal_reason text check (removal_reason is null or removal_reason in ('community_reports', 'operator', 'author')),
  unique (author_id, client_id)
);

create index if not exists posts_public_order_idx
  on public.posts (created_at desc, id desc)
  where removed_at is null;
create index if not exists posts_author_order_idx
  on public.posts (author_id, created_at desc, id desc);

alter table public.posts enable row level security;

create policy "Authors read their own posts"
on public.posts for select to authenticated
using ((select auth.uid()) = author_id);

grant select on public.posts to authenticated;

alter table public.abuse_reports
  add column if not exists post_id uuid references public.posts(id) on delete set null;

create index if not exists abuse_reports_post_idx
  on public.abuse_reports (post_id)
  where post_id is not null;
create unique index if not exists abuse_reports_reporter_post_idx
  on public.abuse_reports (reporter_id, post_id)
  where post_id is not null;

-- Distinct reporters needed before a post is hidden pending operator review.
create or replace function app_private.post_report_threshold()
returns integer
language sql
immutable
set search_path = ''
as $$ select 3 $$;

create or replace function app_private.public_post_json(p_post public.posts, p_profile public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_post.id,
    'body', p_post.body,
    'createdAt', p_post.created_at,
    'author', jsonb_build_object(
      'id', p_profile.id,
      'handle', p_profile.handle,
      'displayName', p_profile.display_name,
      'avatarUrl', p_profile.avatar_url
    )
  );
$$;

-- Public, newest-first post listing with keyset pagination. Signed-in callers
-- additionally do not see authors they blocked or who blocked them.
create or replace function public.open_media_public_posts(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_author_handle text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item.post order by item.created_at desc, item.id desc), '[]'::jsonb)
  from (
    select app_private.public_post_json(post, profile) as post, post.created_at, post.id
    from public.posts post
    join public.profiles profile on profile.id = post.author_id
    where post.removed_at is null
      and (p_author_handle is null or profile.handle = lower(p_author_handle))
      and (
        p_before_created_at is null
        or (post.created_at, post.id) < (p_before_created_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
      )
      and (
        auth.uid() is null
        or not app_private.users_are_blocked(auth.uid(), post.author_id)
      )
    order by post.created_at desc, post.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) item;
$$;

create or replace function public.open_media_public_post(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.public_post_json(post, profile)
  from public.posts post
  join public.profiles profile on profile.id = post.author_id
  where post.id = p_post_id and post.removed_at is null;
$$;

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
    'postCount', (
      select count(*) from public.posts post
      where post.author_id = profile.id and post.removed_at is null
    )
  )
  from public.profiles profile
  where profile.handle = lower(p_handle);
$$;

revoke all on function public.open_media_public_posts(integer, timestamptz, uuid, text) from public;
revoke all on function public.open_media_public_post(uuid) from public;
revoke all on function public.open_media_public_profile(text) from public;
grant execute on function public.open_media_public_posts(integer, timestamptz, uuid, text) to anon, authenticated;
grant execute on function public.open_media_public_post(uuid) to anon, authenticated;
grant execute on function public.open_media_public_profile(text) to anon, authenticated;
revoke all on function app_private.public_post_json(public.posts, public.profiles) from public, anon, authenticated;
revoke all on function app_private.post_report_threshold() from public, anon, authenticated;

create or replace function app_private.create_post(p_client_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_post public.posts;
  v_profile public.profiles;
begin
  if v_user_id is null then
    raise exception 'A valid Open Media session is required.' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_user_id;
  if v_profile.id is null then
    raise exception 'Create your Open Media profile before posting.' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'A post client ID is required.' using errcode = '22023';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'Posts must be between 1 and 2000 characters.' using errcode = '22023';
  end if;

  select * into v_post from public.posts where author_id = v_user_id and client_id = p_client_id;
  if v_post.id is not null then
    return app_private.public_post_json(v_post, v_profile);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 3));
  if (select count(*) from public.posts where author_id = v_user_id and created_at >= pg_catalog.clock_timestamp() - interval '1 hour') >= 30 then
    raise exception 'You are posting too quickly. Wait a while and try again.' using errcode = 'P0001';
  end if;

  insert into public.posts (author_id, client_id, body)
  values (v_user_id, p_client_id, v_body)
  returning * into v_post;
  return app_private.public_post_json(v_post, v_profile);
end;
$$;

create or replace function app_private.delete_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'A valid Open Media session is required.' using errcode = '42501';
  end if;
  delete from public.posts where id = p_post_id and author_id = v_user_id;
  if not found then
    raise exception 'That post is unavailable.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function app_private.report_post(
  p_post_id uuid,
  p_reason text default 'other',
  p_details text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_author_id uuid;
  v_report_id uuid;
begin
  if v_user_id is null then
    raise exception 'A valid Open Media session is required.' using errcode = '42501';
  end if;
  select author_id into v_author_id from public.posts where id = p_post_id and removed_at is null;
  if v_author_id is null then
    raise exception 'That post is unavailable.' using errcode = 'P0002';
  end if;
  if v_author_id = v_user_id then
    raise exception 'You cannot report your own post.' using errcode = '22023';
  end if;

  select id into v_report_id from public.abuse_reports where reporter_id = v_user_id and post_id = p_post_id;
  if v_report_id is not null then return v_report_id; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 2));
  if (select count(*) from public.abuse_reports where reporter_id = v_user_id and created_at >= pg_catalog.clock_timestamp() - interval '1 day') >= 20 then
    raise exception 'Your daily report limit has been reached.' using errcode = 'P0001';
  end if;

  insert into public.abuse_reports (reporter_id, reported_user_id, post_id, reason, details)
  values (v_user_id, v_author_id, p_post_id, p_reason, left(coalesce(btrim(p_details), ''), 500))
  returning id into v_report_id;

  -- Basic community moderation: hide the post once enough distinct people
  -- report it. It stays stored for operator review and can be restored.
  if (select count(distinct reporter_id) from public.abuse_reports where post_id = p_post_id)
     >= app_private.post_report_threshold() then
    update public.posts
    set removed_at = pg_catalog.clock_timestamp(), removal_reason = 'community_reports'
    where id = p_post_id and removed_at is null;
  end if;
  return v_report_id;
end;
$$;

-- Operator-only moderation decision. Not exposed to anon or authenticated.
create or replace function app_private.moderate_post(p_post_id uuid, p_remove boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts
  set removed_at = case when p_remove then coalesce(removed_at, pg_catalog.clock_timestamp()) else null end,
      removal_reason = case when p_remove then 'operator' else null end
  where id = p_post_id;
  if not found then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
  update public.abuse_reports set status = 'closed' where post_id = p_post_id and status <> 'closed';
end;
$$;

revoke all on function app_private.create_post(uuid, text) from public, anon;
revoke all on function app_private.delete_post(uuid) from public, anon;
revoke all on function app_private.report_post(uuid, text, text) from public, anon;
revoke all on function app_private.moderate_post(uuid, boolean) from public, anon, authenticated;
grant execute on function app_private.create_post(uuid, text) to authenticated;
grant execute on function app_private.delete_post(uuid) to authenticated;
grant execute on function app_private.report_post(uuid, text, text) to authenticated;
grant usage on schema app_private to service_role;
grant execute on function app_private.moderate_post(uuid, boolean) to service_role;

create or replace function public.open_media_create_post(p_client_id uuid, p_body text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select app_private.create_post(p_client_id, p_body); $$;

create or replace function public.open_media_delete_post(p_post_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$ select app_private.delete_post(p_post_id); $$;

create or replace function public.open_media_report_post(p_post_id uuid, p_reason text default 'other', p_details text default '')
returns uuid
language sql
security invoker
set search_path = ''
as $$ select app_private.report_post(p_post_id, p_reason, p_details); $$;

revoke all on function public.open_media_create_post(uuid, text) from public, anon;
revoke all on function public.open_media_delete_post(uuid) from public, anon;
revoke all on function public.open_media_report_post(uuid, text, text) from public, anon;
grant execute on function public.open_media_create_post(uuid, text) to authenticated;
grant execute on function public.open_media_delete_post(uuid) to authenticated;
grant execute on function public.open_media_report_post(uuid, text, text) to authenticated;

-- Account export now includes the person's own posts, including hidden ones.
create or replace function public.open_media_export_account_data()
returns jsonb
language sql
security invoker
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'formatVersion', 2,
    'exportedAt', now(),
    'userId', auth.uid(),
    'profile', coalesce((
      select to_jsonb(profile)
      from public.profiles as profile
      where profile.id = auth.uid()
    ), 'null'::jsonb),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', post.id,
        'body', post.body,
        'createdAt', post.created_at,
        'removedAt', post.removed_at,
        'removalReason', post.removal_reason
      ) order by post.created_at)
      from public.posts as post
      where post.author_id = auth.uid()
    ), '[]'::jsonb),
    'conversations', coalesce((
      select jsonb_agg(to_jsonb(conversation) order by conversation.created_at)
      from public.conversations as conversation
    ), '[]'::jsonb),
    'conversationMembers', coalesce((
      select jsonb_agg(to_jsonb(member) order by member.joined_at)
      from public.conversation_members as member
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(to_jsonb(message) order by message.created_at)
      from public.messages as message
    ), '[]'::jsonb),
    'mailAccounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', account.id,
        'email', account.email,
        'protocol', account.protocol,
        'status', account.status,
        'createdAt', account.created_at,
        'updatedAt', account.updated_at
      ) order by account.created_at)
      from private.mail_accounts as account
      where account.user_id = auth.uid()
    ), '[]'::jsonb),
    'mailMessages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', message.id,
        'accountId', message.account_id,
        'sourceMessageId', message.source_message_id,
        'mailbox', message.mailbox,
        'subject', message.subject,
        'sender', message.sender,
        'recipients', message.recipients,
        'sentAt', message.sent_at,
        'bodyText', message.body_text,
        'createdAt', message.created_at
      ) order by message.sent_at)
      from private.mail_messages as message
      where message.user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.open_media_export_account_data() from public, anon;
grant execute on function public.open_media_export_account_data() to authenticated;

comment on table public.posts is 'Public Open Media posts. Readable by anyone through the open_media_public_* functions; removed posts are hidden but retained for review.';
comment on function public.open_media_public_posts(integer, timestamptz, uuid, text) is 'Public, anonymous-safe post listing with keyset pagination (max 50).';
comment on function public.open_media_report_post(uuid, text, text) is 'Rate-limited, idempotent post report. Posts auto-hide after the distinct-reporter threshold.';
