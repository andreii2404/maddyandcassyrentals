-- Track Booking: booking-reference lookup verified by a one-time code that is
-- emailed to the address saved on the booking. A booking reference alone never
-- grants access. Codes are stored only as SHA-256 hashes, expire after ten
-- minutes, allow five attempts, and can be redeemed once. Redeeming a guest
-- booking moves only that booking into the caller's anonymous session (the
-- same ownership transfer recover_guest_booking_access performs); account
-- bookings are never reassigned and still require signing in.

begin;

create table public.booking_lookup_challenges (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  code_hash text not null,
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index booking_lookup_challenges_booking_idx
  on public.booking_lookup_challenges (booking_id, created_at desc);

alter table public.booking_lookup_challenges enable row level security;

-- No policies: only the service role (server routes) can touch challenges.
revoke all on table public.booking_lookup_challenges from public, anon, authenticated;
grant all on table public.booking_lookup_challenges to service_role;

create or replace function public.create_booking_lookup_challenge(
  p_booking_id uuid,
  p_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_booking_id is null or coalesce(p_code, '') !~ '^[0-9]{6}$' then
    raise exception 'INVALID_LOOKUP_CHALLENGE';
  end if;

  -- Serialize code requests per booking so the resend cooldown holds.
  perform pg_advisory_xact_lock(hashtext('booking_lookup:' || p_booking_id::text));

  if not exists (select 1 from public.bookings as booking where booking.id = p_booking_id) then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.booking_lookup_challenges as challenge
    where challenge.booking_id = p_booking_id
      and challenge.created_at > now() - interval '60 seconds'
  ) then
    raise exception 'LOOKUP_COOLDOWN';
  end if;

  -- A new code replaces any earlier unused code for this booking.
  update public.booking_lookup_challenges as challenge
  set expires_at = now()
  where challenge.booking_id = p_booking_id
    and challenge.consumed_at is null
    and challenge.expires_at > now();

  delete from public.booking_lookup_challenges as challenge
  where challenge.booking_id = p_booking_id
    and challenge.created_at < now() - interval '1 day';

  insert into public.booking_lookup_challenges (id, booking_id, code_hash, expires_at)
  values (
    v_id,
    p_booking_id,
    encode(sha256(convert_to(v_id::text || ':' || p_code, 'UTF8')), 'hex'),
    now() + interval '10 minutes'
  );

  return v_id;
end;
$$;

revoke all on function public.create_booking_lookup_challenge(uuid, text) from public, anon, authenticated;
grant execute on function public.create_booking_lookup_challenge(uuid, text) to service_role;

-- Returns one row:
--   status 'invalid'          wrong, expired, used, or locked code
--   status 'session_required' correct code for a guest booking, but the caller
--                             has no anonymous session (code is not consumed)
--   status 'guest'            guest booking moved into p_target_user_id
--   status 'account'          booking belongs to a customer account; the
--                             caller must sign in to that account to view it
create or replace function public.redeem_booking_lookup_challenge(
  p_challenge_id uuid,
  p_code text,
  p_target_user_id uuid
)
returns table (status text, booking_id uuid, customer_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_challenge public.booking_lookup_challenges%rowtype;
  v_target_is_anonymous boolean := false;
  v_owner_id uuid;
  v_is_guest_checkout boolean;
  v_owner_is_anonymous boolean;
  v_display_name text;
  v_contact_email text;
  v_profile_phone text;
  v_full_address text;
  v_facebook_url text;
  v_instagram_url text;
begin
  if p_challenge_id is null then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  select challenge.* into v_challenge
  from public.booking_lookup_challenges as challenge
  where challenge.id = p_challenge_id
  for update;

  if not found
    or v_challenge.consumed_at is not null
    or v_challenge.expires_at <= now()
    or v_challenge.attempts >= 5
  then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  update public.booking_lookup_challenges as challenge
  set attempts = challenge.attempts + 1
  where challenge.id = v_challenge.id;

  if coalesce(p_code, '') !~ '^[0-9]{6}$'
    or v_challenge.code_hash <> encode(
      sha256(convert_to(v_challenge.id::text || ':' || p_code, 'UTF8')),
      'hex'
    )
  then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  select
    booking.customer_id,
    booking.is_guest_checkout,
    coalesce(customer.is_anonymous, false),
    profile.display_name,
    profile.contact_email,
    profile.phone_number,
    profile.full_address,
    profile.facebook_url,
    profile.instagram_url
  into
    v_owner_id,
    v_is_guest_checkout,
    v_owner_is_anonymous,
    v_display_name,
    v_contact_email,
    v_profile_phone,
    v_full_address,
    v_facebook_url,
    v_instagram_url
  from public.bookings as booking
  join auth.users as customer on customer.id = booking.customer_id
  left join public.profiles as profile on profile.id = booking.customer_id
  where booking.id = v_challenge.booking_id
  for update of booking;

  if not found then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  if not (v_is_guest_checkout is true and v_owner_is_anonymous) then
    update public.booking_lookup_challenges as challenge
    set consumed_at = now()
    where challenge.id = v_challenge.id;
    return query select 'account'::text, v_challenge.booking_id, v_owner_id;
    return;
  end if;

  if p_target_user_id is not null then
    select coalesce(target_user.is_anonymous, false) into v_target_is_anonymous
    from auth.users as target_user
    where target_user.id = p_target_user_id;
  end if;

  if not coalesce(v_target_is_anonymous, false) then
    return query select 'session_required'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_owner_id <> p_target_user_id then
    update public.profiles as target_profile
    set
      display_name = v_display_name,
      contact_email = v_contact_email,
      phone_number = v_profile_phone,
      full_address = v_full_address,
      facebook_url = v_facebook_url,
      instagram_url = v_instagram_url,
      is_guest_contact = true,
      updated_at = now()
    where target_profile.id = p_target_user_id;

    if not found then
      raise exception 'CUSTOMER_PROFILE_REQUIRED';
    end if;

    update public.bookings as booking
    set customer_id = p_target_user_id, updated_at = now()
    where booking.id = v_challenge.booking_id
      and booking.customer_id = v_owner_id
      and booking.is_guest_checkout is true;

    if not found then
      raise exception 'GUEST_BOOKING_RECOVERY_CONFLICT';
    end if;

    update public.notifications as notification
    set user_id = p_target_user_id
    where notification.booking_id = v_challenge.booking_id
      and notification.user_id = v_owner_id;
  end if;

  update public.booking_lookup_challenges as challenge
  set consumed_at = now()
  where challenge.id = v_challenge.id;

  return query select 'guest'::text, v_challenge.booking_id, p_target_user_id;
end;
$$;

revoke all on function public.redeem_booking_lookup_challenge(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.redeem_booking_lookup_challenge(uuid, text, uuid) to service_role;

comment on function public.redeem_booking_lookup_challenge(uuid, text, uuid) is
  'Verifies a Track Booking one-time code. Guest bookings move into the caller''s anonymous session; account bookings are only confirmed, never reassigned.';

commit;
