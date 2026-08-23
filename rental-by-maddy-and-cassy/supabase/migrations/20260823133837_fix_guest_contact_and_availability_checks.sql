-- Guest checkout contact emails are operational contact details, not account
-- identities. Mark the temporary profile accordingly so a guest may use an
-- email that already belongs to a registered account without weakening the
-- registered-profile duplicate guard.
alter table public.profiles
  add column if not exists is_guest_contact boolean not null default false;

update public.profiles as profile
set is_guest_contact = true
from auth.users as auth_user
where auth_user.id = profile.id
  and auth_user.is_anonymous is true;

drop index if exists public.profiles_contact_email_unique_idx;
create unique index profiles_contact_email_unique_idx
  on public.profiles (lower(contact_email))
  where contact_email is not null and is_guest_contact is false;

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
    is_guest_contact = true,
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
  'Validates and stores anonymous guest contact data without treating the temporary guest profile as a registered account identity.';

-- Qualify count_unit_availability's output column. In PL/pgSQL the function's
-- available_units output parameter otherwise makes the unqualified SELECT
-- ambiguous, which leaves the reservation screen stuck on "Checking" for
-- outside-hours selections.
create or replace function public.get_product_time_availability(
  p_product_id uuid,
  p_pickup_at timestamptz,
  p_quantity integer default 1
)
returns table (
  product_id uuid,
  total_units bigint,
  available_units bigint,
  unavailable_units bigint,
  next_available_at timestamptz,
  pickup_convenience_fee numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity integer := greatest(coalesce(p_quantity, 1), 1);
  v_window tstzrange := tstzrange(p_pickup_at, p_pickup_at + interval '24 hours', '[)');
  v_local_time time := (p_pickup_at at time zone 'Asia/Manila')::time;
  v_closing_at timestamptz;
  v_available_at_closing bigint := 0;
  v_counts record;
begin
  if p_pickup_at is null then
    raise exception 'PICKUP_TIME_REQUIRED';
  end if;

  select * into v_counts from private.count_unit_availability(p_product_id, v_window);
  total_units := coalesce(v_counts.total_units, 0);
  available_units := coalesce(v_counts.available_units, 0);

  product_id := p_product_id;
  unavailable_units := greatest(total_units - available_units, 0);
  next_available_at := case
    when available_units >= v_quantity then p_pickup_at
    else private.next_product_pickup_at(p_product_id, p_pickup_at, v_quantity)
  end;

  pickup_convenience_fee := 0;
  if v_local_time < time '09:00' then
    pickup_convenience_fee := 100;
  elsif v_local_time > time '19:00' then
    v_closing_at := (
      (p_pickup_at at time zone 'Asia/Manila')::date + time '19:00'
    ) at time zone 'Asia/Manila';

    select closing_counts.available_units
      into v_available_at_closing
      from private.count_unit_availability(
        p_product_id,
        tstzrange(v_closing_at, v_closing_at + interval '24 hours', '[)')
      ) as closing_counts;

    if v_available_at_closing >= v_quantity then
      pickup_convenience_fee := 100;
    end if;
  end if;

  return next;
end;
$$;

create or replace function public.get_product_multi_day_time_availability(
  p_product_id uuid,
  p_pickup_at timestamptz,
  p_quantity integer default 1,
  p_rental_days integer default 1
)
returns table (
  product_id uuid,
  total_units bigint,
  available_units bigint,
  unavailable_units bigint,
  next_available_at timestamptz,
  pickup_convenience_fee numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity integer := greatest(coalesce(p_quantity, 1), 1);
  v_days integer := least(greatest(coalesce(p_rental_days, 1), 1), 30);
  v_window tstzrange;
  v_local_time time := (p_pickup_at at time zone 'Asia/Manila')::time;
  v_closing_at timestamptz;
  v_available_at_closing bigint := 0;
  v_counts record;
begin
  if p_pickup_at is null then
    raise exception 'PICKUP_TIME_REQUIRED';
  end if;

  v_window := tstzrange(
    p_pickup_at,
    p_pickup_at + make_interval(days => v_days),
    '[)'
  );

  select * into v_counts from private.count_unit_availability(p_product_id, v_window);
  total_units := coalesce(v_counts.total_units, 0);
  available_units := coalesce(v_counts.available_units, 0);

  product_id := p_product_id;
  unavailable_units := greatest(total_units - available_units, 0);
  next_available_at := case
    when available_units >= v_quantity then p_pickup_at
    else private.next_product_multi_day_pickup_at(p_product_id, p_pickup_at, v_quantity, v_days)
  end;

  pickup_convenience_fee := 0;
  if v_local_time < time '09:00' then
    pickup_convenience_fee := 100;
  elsif v_local_time > time '19:00' then
    v_closing_at := (
      (p_pickup_at at time zone 'Asia/Manila')::date + time '19:00'
    ) at time zone 'Asia/Manila';

    select closing_counts.available_units
      into v_available_at_closing
      from private.count_unit_availability(
        p_product_id,
        tstzrange(v_closing_at, v_closing_at + make_interval(days => v_days), '[)')
      ) as closing_counts;

    if v_available_at_closing >= v_quantity then
      pickup_convenience_fee := 100;
    end if;
  end if;

  return next;
end;
$$;

revoke all on function public.get_product_time_availability(uuid, timestamptz, integer) from public;
revoke all on function public.get_product_multi_day_time_availability(uuid, timestamptz, integer, integer) from public;
grant execute on function public.get_product_time_availability(uuid, timestamptz, integer) to anon, authenticated;
grant execute on function public.get_product_multi_day_time_availability(uuid, timestamptz, integer, integer) to anon, authenticated;
