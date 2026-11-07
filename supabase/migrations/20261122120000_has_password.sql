-- Whether the signed-in person's account has a password (ADR 0034), so Sign-in and security can say
-- "Change password" instead of "Set password". Only true or false, only about your own account;
-- the password hash never leaves the auth schema.
create or replace function public.open_media_has_password()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select encrypted_password is not null and encrypted_password <> '' from auth.users where id = auth.uid()), false);
$$;

revoke all on function public.open_media_has_password() from public, anon;
grant execute on function public.open_media_has_password() to authenticated;
