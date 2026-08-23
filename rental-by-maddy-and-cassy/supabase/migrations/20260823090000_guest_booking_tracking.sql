-- Guest checkout uses a Supabase anonymous user so the same browser can keep
-- secure, owner-only access through RLS. Persist that checkout mode on each
-- booking, capture the guest's contact details for operational emails, and
-- enforce account-only promotions at the database boundary.

alter table public.bookings
  add column if not exists is_guest_checkout boolean not null default false;

comment on column public.bookings.is_guest_checkout is
  'True when the booking was created by a Supabase anonymous user. Guest bookings remain owner-readable through the temporary authenticated session but do not earn account perks.';

-- Preserve the correct mode for guest bookings created before this migration.
update public.bookings as booking
set
  is_guest_checkout = true,
  birth_date_snapshot = null,
  birthday_discount_amount = 0,
  birthday_discount_status = 'not_eligible',
  loyalty_completed_rentals_snapshot = 0,
  loyalty_discount_amount = 0,
  loyalty_discount_status = 'not_eligible'
from auth.users as customer
where customer.id = booking.customer_id
  and coalesce(customer.is_anonymous, false)
  and not booking.is_guest_checkout;

create or replace function private.enforce_booking_guest_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_guest boolean := false;
  v_completed_account_rentals integer := 0;
  v_loyalty_reward_used boolean := false;
begin
  select coalesce(customer.is_anonymous, false)
    into v_is_guest
    from auth.users as customer
    where customer.id = new.customer_id;

  new.is_guest_checkout := coalesce(v_is_guest, false);

  if new.is_guest_checkout then
    new.birth_date_snapshot := null;
    new.birthday_discount_amount := 0;
    new.birthday_discount_status := 'not_eligible';
    new.loyalty_completed_rentals_snapshot := 0;
    new.loyalty_discount_amount := 0;
    new.loyalty_discount_status := 'not_eligible';
    return new;
  end if;

  -- If an anonymous identity is later converted into a customer account,
  -- rentals made as a guest must still not count toward the 11th-rental perk.
  select count(*)::integer
    into v_completed_account_rentals
    from public.bookings as prior
    where prior.customer_id = new.customer_id
      and prior.status = 'returned'
      and not prior.is_guest_checkout;

  select exists (
    select 1
    from public.bookings as rewarded
    where rewarded.customer_id = new.customer_id
      and not rewarded.is_guest_checkout
      and rewarded.loyalty_discount_amount > 0
      and rewarded.status <> 'cancelled'
  ) into v_loyalty_reward_used;

  new.loyalty_completed_rentals_snapshot := v_completed_account_rentals;
  if v_completed_account_rentals < 10 or v_loyalty_reward_used then
    new.loyalty_discount_amount := 0;
    new.loyalty_discount_status := 'not_eligible';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_booking_guest_rules() from public, anon, authenticated;

drop trigger if exists enforce_booking_guest_rules on public.bookings;
create trigger enforce_booking_guest_rules
before insert on public.bookings
for each row execute function private.enforce_booking_guest_rules();

create or replace function public.save_guest_checkout_contact(p_customer_snapshot jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_guest boolean := false;
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

  select coalesce(customer.is_anonymous, false)
    into v_is_guest
    from auth.users as customer
    where customer.id = v_uid;

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

comment on function public.save_guest_checkout_contact(jsonb) is
  'Stores validated contact details on an anonymous checkout profile so booking notifications and owner-facing booking snapshots work without creating a customer account.';

create index if not exists bookings_account_loyalty_progress_idx
  on public.bookings (customer_id, status)
  where not is_guest_checkout;
