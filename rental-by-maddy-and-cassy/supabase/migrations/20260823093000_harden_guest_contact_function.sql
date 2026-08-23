-- The anonymous marker is a signed Supabase JWT claim. Using it here lets the
-- contact function run as SECURITY INVOKER, so the existing profiles RLS policy
-- remains the final authorization boundary for the update.

create or replace function public.save_guest_checkout_contact(p_customer_snapshot jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_guest boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_full_name text := trim(both from coalesce(p_customer_snapshot ->> 'fullName', ''));
  v_email text := lower(trim(both from coalesce(p_customer_snapshot ->> 'email', '')));
  v_phone text := trim(both from coalesce(p_customer_snapshot ->> 'phone', ''));
  v_address text := trim(both from coalesce(p_customer_snapshot ->> 'address', ''));
  v_facebook text := trim(both from coalesce(p_customer_snapshot ->> 'facebookLink', ''));
  v_instagram text := trim(both from coalesce(p_customer_snapshot ->> 'instagramLink', ''));
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  -- Registered customer profiles continue to use the existing profile flow.
  if not v_is_guest then
    return;
  end if;

  if length(v_full_name) < 2 or length(v_full_name) > 150 then
    raise exception 'INVALID_GUEST_NAME';
  end if;
  if length(v_email) > 254 or v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'INVALID_GUEST_EMAIL';
  end if;
  if v_phone !~ '^[0-9]{11}$' then
    raise exception 'INVALID_GUEST_PHONE';
  end if;
  if length(v_address) < 3 or length(v_address) > 500 then
    raise exception 'INVALID_GUEST_ADDRESS';
  end if;
  if length(v_facebook) > 500 or length(v_instagram) > 500 then
    raise exception 'INVALID_GUEST_SOCIAL_LINK';
  end if;

  update public.profiles
  set
    display_name = v_full_name,
    contact_email = v_email,
    phone_number = v_phone,
    full_address = v_address,
    facebook_url = nullif(v_facebook, ''),
    instagram_url = nullif(v_instagram, ''),
    updated_at = now()
  where id = v_uid;

  if not found then
    raise exception 'CUSTOMER_PROFILE_REQUIRED';
  end if;
end;
$$;

revoke all on function public.save_guest_checkout_contact(jsonb) from public, anon;
grant execute on function public.save_guest_checkout_contact(jsonb) to authenticated;
