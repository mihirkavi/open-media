-- Contact discovery (ADR 0037). A contact you saved by email or phone number connects to that
-- person's Open Media account, the way WhatsApp and Signal find the people in your address book.
--
-- Privacy rules:
--   * Only signed-in people can ask, about at most 500 addresses or numbers at a time (the Worker
--     also rate-limits each person).
--   * Only exact matches on a confirmed sign-in email or confirmed phone number count.
--   * The answer is the account's public handle for each address you already had. It never returns
--     an address you did not send, and never one the account has not confirmed.
--   * People who turned off "Let people who have your email or number find you" never match, and
--     neither do people who blocked you or whom you blocked, nor you yourself.
alter table public.profiles add column if not exists discoverable boolean not null default true;

grant update (discoverable) on public.profiles to authenticated;

create or replace function public.open_media_discover_contacts(p_emails text[], p_phones text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
  v_emails text[];
  v_phones text[];
begin
  if v_viewer is null then
    raise exception 'sign in to find your contacts' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_emails), 0) + coalesce(cardinality(p_phones), 0) > 500 then
    raise exception 'send at most 500 addresses and numbers at a time' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct lower(btrim(value))), '{}') into v_emails
    from unnest(coalesce(p_emails, '{}')) as value where btrim(value) like '%_@_%';
  -- Numbers compare as digits with their country code; one without "+" is too ambiguous to match.
  select coalesce(array_agg(distinct regexp_replace(value, '\D', '', 'g')), '{}') into v_phones
    from unnest(coalesce(p_phones, '{}')) as value where btrim(value) like '+%' and length(regexp_replace(value, '\D', '', 'g')) between 8 and 15;

  return coalesce((
    select jsonb_agg(jsonb_build_object('kind', match.kind, 'value', match.value, 'handle', p.handle) order by match.kind, match.value)
    from (
      select 'email' as kind, lower(u.email) as value, u.id
        from auth.users u
        where u.email_confirmed_at is not null and lower(u.email) = any (v_emails)
      union all
      select 'phone', '+' || regexp_replace(u.phone, '\D', '', 'g'), u.id
        from auth.users u
        where u.phone_confirmed_at is not null and coalesce(u.phone, '') <> '' and regexp_replace(u.phone, '\D', '', 'g') = any (v_phones)
    ) as match
    join public.profiles p on p.id = match.id
    where p.discoverable
      and p.id <> v_viewer
      and not app_private.users_are_blocked(v_viewer, p.id)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.open_media_discover_contacts(text[], text[]) from public, anon;
grant execute on function public.open_media_discover_contacts(text[], text[]) to authenticated;

-- Your own setting, alongside the rest of your identity choices.
create or replace function public.open_media_my_identity()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tier', app_private.identity_tier(p),
    'verified', app_private.is_verified(p.id),
    'shownName', app_private.shown_name(p),
    'nameDisclosure', p.name_disclosure,
    'visibility', p.visibility,
    'discoverable', p.discoverable,
    'verification', (select jsonb_build_object('provider', v.provider, 'status', v.status, 'verifiedAt', v.verified_at, 'expiresAt', v.expires_at,
      'legalNameShown', v.disclosed_legal_name is not null, 'documentCountry', v.document_country)
      from public.identity_verifications v where v.user_id = p.id),
    'pendingRequests', (select count(*) from public.follows f where f.followee_id = p.id and f.status = 'pending')
  )
  from public.profiles p where p.id = auth.uid();
$$;
