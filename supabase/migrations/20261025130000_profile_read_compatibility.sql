-- Installed app versions read other people's profile rows directly (search and conversation
-- names). Keep that working without exposing anything new: rows stay readable only when they are
-- public and show a declared name, or when you already share a conversation with that person.
-- Private accounts and handle-only people are reached only through the profile functions, which
-- return the shown name. A verified legal name is never stored in this table.
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
      where p.id = p_owner and p.visibility = 'public' and p.name_disclosure <> 'handle_only'
        and not app_private.users_are_blocked(auth.uid(), p_owner)
    )
    or app_private.shares_conversation(auth.uid(), p_owner)
  );
$$;

revoke all on function app_private.profile_row_visible(uuid) from public, anon;
grant execute on function app_private.profile_row_visible(uuid) to authenticated;

drop policy if exists "People read their own profile" on public.profiles;
drop policy if exists "People read profiles they may see" on public.profiles;
create policy "People read profiles they may see" on public.profiles for select to authenticated
  using (id = auth.uid() or app_private.profile_row_visible(id));
