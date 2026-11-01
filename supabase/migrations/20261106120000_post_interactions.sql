-- Likes, comments, and reshares on Open Media posts.
--
-- The Feed's existing comment, reshare, and like icons now act. Each table is
-- written only through the security-definer functions below, which apply the
-- same visibility rule as reading a post (blocks, private profiles, held
-- listings). People can read their own rows directly, for the account export.
-- Counts and the viewer's own like and reshare travel with every public post.

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.post_reshares (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (author_id, client_id)
);

create index if not exists post_likes_user_idx on public.post_likes (user_id, created_at desc);
create index if not exists post_reshares_user_idx on public.post_reshares (user_id, created_at desc);
create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at, id) where removed_at is null;
create index if not exists post_comments_author_idx on public.post_comments (author_id, created_at desc);

alter table public.post_likes enable row level security;
alter table public.post_reshares enable row level security;
alter table public.post_comments enable row level security;

drop policy if exists "People read their own likes" on public.post_likes;
create policy "People read their own likes" on public.post_likes for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "People read their own reshares" on public.post_reshares;
create policy "People read their own reshares" on public.post_reshares for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "People read their own comments" on public.post_comments;
create policy "People read their own comments" on public.post_comments for select to authenticated using ((select auth.uid()) = author_id);

revoke all on public.post_likes, public.post_reshares, public.post_comments from public, anon, authenticated;
grant select on public.post_likes, public.post_reshares, public.post_comments to authenticated;

-- Whether the viewer may see (and so act on) a post: the same rule open_media_public_post applies.
create or replace function app_private.can_view_post(p_post_id uuid, p_viewer uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.posts post
    where post.id = p_post_id and post.removed_at is null
      and app_private.can_view_profile(p_viewer, post.author_id)
      and not app_private.listing_hidden(post.id, p_viewer)
  );
$$;
revoke all on function app_private.can_view_post(uuid, uuid) from public, anon;
grant execute on function app_private.can_view_post(uuid, uuid) to anon, authenticated;

create or replace function app_private.post_engagement_json(p_post_id uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'replies', (select count(*) from public.post_comments c where c.post_id = p_post_id and c.removed_at is null),
    'reposts', (select count(*) from public.post_reshares r where r.post_id = p_post_id),
    'likes', (select count(*) from public.post_likes l where l.post_id = p_post_id),
    'liked', p_viewer is not null and exists (select 1 from public.post_likes l where l.post_id = p_post_id and l.user_id = p_viewer),
    'reshared', p_viewer is not null and exists (select 1 from public.post_reshares r where r.post_id = p_post_id and r.user_id = p_viewer)
  );
$$;
revoke all on function app_private.post_engagement_json(uuid, uuid) from public, anon;
grant execute on function app_private.post_engagement_json(uuid, uuid) to anon, authenticated;

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
    'paid', app_private.paid_json(p_post.id),
    'engagement', app_private.post_engagement_json(p_post.id, auth.uid())
  );
$$;

-- Checks shared by every write: a signed-in person with a profile, acting on a post they can see.
create or replace function app_private.require_post_actor(p_post_id uuid)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
begin
  if v_viewer is null then raise exception 'Sign in to like, comment, or reshare.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_viewer) then
    raise exception 'Create your Open Media profile first.' using errcode = '42501';
  end if;
  if p_post_id is null or not app_private.can_view_post(p_post_id, v_viewer) then
    raise exception 'That post isn’t available.' using errcode = 'P0002';
  end if;
  return v_viewer;
end;
$$;
revoke all on function app_private.require_post_actor(uuid) from public, anon;
grant execute on function app_private.require_post_actor(uuid) to authenticated;

create or replace function public.open_media_set_post_like(p_post_id uuid, p_liked boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_viewer uuid := app_private.require_post_actor(p_post_id);
begin
  if p_liked then
    insert into public.post_likes (post_id, user_id) values (p_post_id, v_viewer) on conflict do nothing;
  else
    delete from public.post_likes where post_id = p_post_id and user_id = v_viewer;
  end if;
  return app_private.post_engagement_json(p_post_id, v_viewer);
end;
$$;

create or replace function public.open_media_set_post_reshare(p_post_id uuid, p_reshared boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_viewer uuid := app_private.require_post_actor(p_post_id);
begin
  if p_reshared then
    insert into public.post_reshares (post_id, user_id) values (p_post_id, v_viewer) on conflict do nothing;
  else
    delete from public.post_reshares where post_id = p_post_id and user_id = v_viewer;
  end if;
  return app_private.post_engagement_json(p_post_id, v_viewer);
end;
$$;

create or replace function app_private.post_comment_json(p_comment public.post_comments, p_profile public.profiles)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_comment.id,
    'postId', p_comment.post_id,
    'body', p_comment.body,
    'createdAt', p_comment.created_at,
    'author', jsonb_build_object(
      'id', p_profile.id,
      'handle', p_profile.handle,
      'displayName', app_private.shown_name(p_profile),
      'avatarUrl', p_profile.avatar_url,
      'verified', app_private.is_verified(p_profile.id)
    )
  );
$$;
revoke all on function app_private.post_comment_json(public.post_comments, public.profiles) from public, anon;
grant execute on function app_private.post_comment_json(public.post_comments, public.profiles) to anon, authenticated;

-- Idempotent on the client ID, so a retried send never comments twice.
create or replace function public.open_media_add_post_comment(p_post_id uuid, p_client_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_viewer uuid := app_private.require_post_actor(p_post_id);
  v_body text := btrim(coalesce(p_body, ''));
  v_comment public.post_comments;
begin
  if p_client_id is null then raise exception 'A comment client ID is required.' using errcode = '22023'; end if;
  if char_length(v_body) not between 1 and 1000 then raise exception 'Comments must be between 1 and 1000 characters.' using errcode = '22023'; end if;
  select * into v_comment from public.post_comments where author_id = v_viewer and client_id = p_client_id;
  if v_comment.id is null then
    if (select count(*) from public.post_comments where author_id = v_viewer and created_at > now() - interval '1 hour') >= 60 then
      raise exception 'Too many comments. Try again later.' using errcode = '54000';
    end if;
    insert into public.post_comments (post_id, author_id, client_id, body) values (p_post_id, v_viewer, p_client_id, v_body) returning * into v_comment;
  end if;
  return app_private.post_comment_json(v_comment, (select profile from public.profiles profile where profile.id = v_viewer));
end;
$$;

-- Oldest first, like a conversation. Comments by people the viewer cannot see are left out.
create or replace function public.open_media_post_comments(p_post_id uuid, p_limit integer default 50)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(item.comment order by item.created_at, item.id), '[]'::jsonb)
  from (
    select app_private.post_comment_json(comment, profile) as comment, comment.created_at, comment.id
    from public.post_comments comment
    join public.profiles profile on profile.id = comment.author_id
    where comment.post_id = p_post_id and comment.removed_at is null
      and app_private.can_view_post(p_post_id, auth.uid())
      and app_private.can_view_profile(auth.uid(), comment.author_id)
    order by comment.created_at, comment.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) item;
$$;

revoke all on function public.open_media_set_post_like(uuid, boolean) from public, anon;
revoke all on function public.open_media_set_post_reshare(uuid, boolean) from public, anon;
revoke all on function public.open_media_add_post_comment(uuid, uuid, text) from public, anon;
revoke all on function public.open_media_post_comments(uuid, integer) from public;
grant execute on function public.open_media_set_post_like(uuid, boolean) to authenticated;
grant execute on function public.open_media_set_post_reshare(uuid, boolean) to authenticated;
grant execute on function public.open_media_add_post_comment(uuid, uuid, text) to authenticated;
grant execute on function public.open_media_post_comments(uuid, integer) to anon, authenticated;

-- The account export now includes the person's likes, reshares, and comments.
create or replace function public.open_media_export_account_data()
returns jsonb
language sql
security invoker
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'formatVersion', 3,
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
    'postLikes', coalesce((
      select jsonb_agg(jsonb_build_object('postId', item.post_id, 'createdAt', item.created_at) order by item.created_at)
      from public.post_likes as item
      where item.user_id = auth.uid()
    ), '[]'::jsonb),
    'postReshares', coalesce((
      select jsonb_agg(jsonb_build_object('postId', item.post_id, 'createdAt', item.created_at) order by item.created_at)
      from public.post_reshares as item
      where item.user_id = auth.uid()
    ), '[]'::jsonb),
    'postComments', coalesce((
      select jsonb_agg(jsonb_build_object('id', item.id, 'postId', item.post_id, 'body', item.body, 'createdAt', item.created_at, 'removedAt', item.removed_at) order by item.created_at)
      from public.post_comments as item
      where item.author_id = auth.uid()
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

comment on table public.post_likes is 'One like per person per Open Media post. Written only through open_media_set_post_like.';
comment on table public.post_reshares is 'One reshare per person per Open Media post. Written only through open_media_set_post_reshare.';
comment on table public.post_comments is 'Public comments on Open Media posts, readable through open_media_post_comments under the post''s visibility rule.';
