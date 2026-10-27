-- Security hardening after the 2026-10-26 review.
--
-- 1. A shared conversation no longer reveals a private or handle-only profile's full row. Opening
--    a DM with someone used to make their hidden name, private bio and linked accounts readable.
--    Now a conversation reveals the row only once that person has written in it themselves, never
--    for handle-only profiles (their display name is meant to stay hidden), and never across a block.
-- 2. Sent messages are immutable for clients: nobody edits messages from the app, and the old
--    table-wide UPDATE grant let a sender move a message into a conversation they were blocked
--    from, backdate it past the rate limits, or relabel its transport.
-- 3. Profiles: clients may write only the fields a person edits; created_at, onboarding and tips
--    change only through the server.
-- 4. Supabase's default TRUNCATE, TRIGGER and REFERENCES grants are revoked; TRUNCATE ignores RLS.
-- 5. Conversations are created only through open_media_start_direct_conversation.
-- 6. Paid-post details and listing ratings respect who may see the author's profile.

-- 1 ─────────────────────────────────────────────────────────────────────────────

create or replace function app_private.profile_row_visible(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    p_owner = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = p_owner and p.name_disclosure <> 'handle_only'
        and not app_private.users_are_blocked(auth.uid(), p_owner)
        and (
          p.visibility = 'public'
          -- They wrote to the viewer in a conversation they share: the viewer may see who they are.
          or exists (
            select 1
            from public.messages m
            join public.conversation_members viewer on viewer.conversation_id = m.conversation_id and viewer.user_id = auth.uid()
            where m.sender_id = p_owner
          )
        )
    )
  );
$$;
revoke all on function app_private.profile_row_visible(uuid) from public, anon;
grant execute on function app_private.profile_row_visible(uuid) to authenticated;

-- 2 ─────────────────────────────────────────────────────────────────────────────

revoke update on public.messages from authenticated, anon;
drop policy if exists "Senders edit their own messages" on public.messages;

-- 3 ─────────────────────────────────────────────────────────────────────────────

revoke insert, update on public.profiles from authenticated, anon;
grant insert (id, handle, display_name, bio, avatar_url, linked_accounts, name_disclosure, visibility) on public.profiles to authenticated;
-- id is listed because upserts set it; the row policy still pins every write to auth.uid().
grant update (id, handle, display_name, bio, avatar_url, linked_accounts, name_disclosure, visibility, updated_at) on public.profiles to authenticated;

-- 4 ─────────────────────────────────────────────────────────────────────────────

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- 5 ─────────────────────────────────────────────────────────────────────────────

revoke insert on public.conversations from authenticated, anon;

-- 6 ─────────────────────────────────────────────────────────────────────────────

create or replace function public.open_media_paid_post_content(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.paid_json(p_post_id)
  where auth.uid() is not null
    and exists (
      select 1 from public.posts p
      where p.id = p_post_id and p.removed_at is null and app_private.can_view_profile(auth.uid(), p.author_id)
    );
$$;
revoke all on function public.open_media_paid_post_content(uuid) from public, anon;
grant execute on function public.open_media_paid_post_content(uuid) to authenticated;

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
  if app_private.users_are_blocked(v_user, v_listing.author_id) or not app_private.can_view_profile(v_user, v_listing.author_id) then
    raise exception 'Listing not found.' using errcode = 'P0002';
  end if;
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
revoke all on function public.open_media_rate_listing(uuid, integer) from public, anon;
grant execute on function public.open_media_rate_listing(uuid, integer) to authenticated;
