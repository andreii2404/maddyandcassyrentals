-- Add the renter data and booking snapshots needed for the birthday-month
-- discount and the one-time 11th-rental loyalty reward. Eligibility and
-- amounts are decided inside create_booking(), never by browser input.

alter table public.profiles
  add column birth_date date,
  add column birth_date_verified_at timestamptz,
  add column birth_date_verified_by uuid references auth.users(id) on delete set null;

alter table public.profiles
  add constraint profiles_birth_date_reasonable
  check (birth_date is null or (birth_date >= date '1900-01-01' and birth_date <= current_date));

alter table public.bookings
  add column birth_date_snapshot date,
  add column birthday_discount_amount numeric(12,2) not null default 0,
  add column birthday_discount_status text not null default 'not_eligible',
  add column loyalty_completed_rentals_snapshot integer not null default 0,
  add column loyalty_discount_amount numeric(12,2) not null default 0,
  add column loyalty_discount_status text not null default 'not_eligible';

alter table public.bookings
  add constraint bookings_birthday_discount_amount_nonnegative
    check (birthday_discount_amount >= 0),
  add constraint bookings_loyalty_discount_amount_nonnegative
    check (loyalty_discount_amount >= 0),
  add constraint bookings_loyalty_count_nonnegative
    check (loyalty_completed_rentals_snapshot >= 0),
  add constraint bookings_birthday_discount_status_valid
    check (birthday_discount_status in ('not_eligible', 'pending_verification', 'verified', 'rejected')),
  add constraint bookings_loyalty_discount_status_valid
    check (loyalty_discount_status in ('not_eligible', 'applied', 'voided'));

create index bookings_customer_status_rewards_idx
  on public.bookings (customer_id, status, loyalty_discount_amount);

create or replace function private.protect_profile_birth_date()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.birth_date is not null
    and new.birth_date is distinct from old.birth_date
    and not (select private.is_admin())
  then
    raise exception 'BIRTH_DATE_LOCKED';
  end if;

  if (
    new.birth_date_verified_at is distinct from old.birth_date_verified_at
    or new.birth_date_verified_by is distinct from old.birth_date_verified_by
  ) and not (select private.is_admin())
  then
    raise exception 'BIRTH_DATE_VERIFICATION_ADMIN_ONLY';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_profile_birth_date() from public, anon, authenticated;

drop trigger if exists protect_profile_birth_date on public.profiles;
create trigger protect_profile_birth_date
before update of birth_date, birth_date_verified_at, birth_date_verified_by
on public.profiles
for each row execute function private.protect_profile_birth_date();

create or replace function public.create_booking(
  p_product_id uuid,
  p_rental_start_date date,
  p_rental_end_date date,
  p_fulfillment_method text,
  p_location text,
  p_customer_notes text,
  p_delivery_fee numeric,
  p_discount_amount numeric,
  p_product_snapshot jsonb,
  p_customer_snapshot jsonb,
  p_emergency_contact jsonb default null,
  p_city_municipality text default null,
  p_province text default null,
  p_quantity integer default 1
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_product record;
  v_unit_ids uuid[];
  v_item_id uuid;
  v_period daterange;
  v_quantity integer;
  v_rental_days integer;
  v_catalog_daily_rate numeric(12,2);
  v_catalog_subtotal numeric(12,2);
  v_delivery_fee numeric(12,2);
  v_discount_percent numeric := 0;
  v_discount_text text;
  v_birth_date date;
  v_birth_date_verified_at timestamptz;
  v_birthday_discount numeric(12,2) := 0;
  v_birthday_status text := 'not_eligible';
  v_completed_rentals integer := 0;
  v_loyalty_reward_used boolean := false;
  v_loyalty_discount numeric(12,2) := 0;
  v_loyalty_status text := 'not_eligible';
  v_booking public.bookings;
  v_address_line_1 text;
  v_city_municipality text;
  v_province text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select pr.birth_date, pr.birth_date_verified_at
    into v_birth_date, v_birth_date_verified_at
    from public.profiles pr
    where pr.id = v_uid
      and pr.account_status <> 'suspended'
    for update;

  if not found then
    if exists (select 1 from public.profiles pr where pr.id = v_uid and pr.account_status = 'suspended') then
      raise exception 'ACCOUNT_SUSPENDED' using errcode = '42501';
    end if;
    raise exception 'CUSTOMER_PROFILE_REQUIRED';
  end if;

  v_quantity := coalesce(p_quantity, 1);
  if v_quantity < 1 or v_quantity > 10 then
    raise exception 'INVALID_QUANTITY';
  end if;

  if p_fulfillment_method not in ('pickup', 'delivery') then
    raise exception 'INVALID_FULFILLMENT_METHOD';
  end if;

  if p_rental_end_date < p_rental_start_date then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  if p_rental_start_date < (now() at time zone 'Asia/Manila')::date then
    raise exception 'RENTAL_START_IN_PAST';
  end if;

  if p_fulfillment_method = 'delivery' then
    v_address_line_1 := nullif(trim(both from coalesce(p_location, '')), '');
    v_city_municipality := nullif(trim(both from coalesce(p_city_municipality, '')), '');
    v_province := nullif(trim(both from coalesce(p_province, '')), '');
    if v_address_line_1 is null or v_city_municipality is null or v_province is null then
      raise exception 'DELIVERY_ADDRESS_REQUIRED';
    end if;
  else
    v_address_line_1 := null;
    v_city_municipality := null;
    v_province := null;
  end if;

  select id, daily_rate, refundable_deposit, specifications, status
    into v_product
    from public.products
    where id = p_product_id
    for share;

  if v_product.id is null or v_product.status <> 'active' then
    raise exception 'PRODUCT_NOT_AVAILABLE';
  end if;

  v_discount_text := nullif(v_product.specifications ->> 'discountPercent', '');
  if v_discount_text is not null and v_discount_text ~ '^([0-9]+)(\.[0-9]+)?$' then
    v_discount_percent := least(greatest(v_discount_text::numeric, 0), 90);
  end if;

  v_period := daterange(p_rental_start_date, p_rental_end_date + 1, '[)');
  v_rental_days := (p_rental_end_date - p_rental_start_date) + 1;
  v_catalog_daily_rate := round(v_product.daily_rate * (1 - (v_discount_percent / 100)), 2);
  v_catalog_subtotal := v_catalog_daily_rate * v_rental_days * v_quantity;
  v_delivery_fee := case when p_fulfillment_method = 'delivery'
    then greatest(coalesce(p_delivery_fee, 0), 0)
    else 0
  end;

  if v_birth_date is not null and exists (
    select 1
    from generate_series(p_rental_start_date, p_rental_end_date, interval '1 day') as rental_day
    where extract(month from rental_day) = extract(month from v_birth_date)
  ) then
    v_birthday_discount := least(100, v_catalog_subtotal);
    v_birthday_status := case
      when v_birth_date_verified_at is null then 'pending_verification'
      else 'verified'
    end;
  end if;

  select count(*)::integer
    into v_completed_rentals
    from public.bookings prior
    where prior.customer_id = v_uid
      and prior.status = 'returned';

  select exists (
    select 1
    from public.bookings reward_booking
    where reward_booking.customer_id = v_uid
      and reward_booking.loyalty_discount_amount > 0
      and reward_booking.status <> 'cancelled'
  ) into v_loyalty_reward_used;

  if v_completed_rentals >= 10 and not v_loyalty_reward_used then
    v_loyalty_discount := least(200, greatest(v_catalog_subtotal - v_birthday_discount, 0));
    if v_loyalty_discount > 0 then
      v_loyalty_status := 'applied';
    end if;
  end if;

  select coalesce(array_agg(candidate.id), '{}'::uuid[])
    into v_unit_ids
    from (
      select iu.id
      from public.inventory_units iu
      where iu.product_id = p_product_id
        and iu.lifecycle_status = 'active'
        and not exists (
          select 1 from public.unit_reservations ur
          where ur.inventory_unit_id = iu.id
            and ur.status in ('tentative', 'confirmed', 'in_use')
            and ur.reserved_period && v_period
        )
      order by iu.id
      for update of iu skip locked
      limit v_quantity
    ) candidate;

  if cardinality(v_unit_ids) < v_quantity then
    raise exception 'NO_AVAILABILITY' using errcode = 'P0001';
  end if;

  insert into public.bookings (
    customer_id, status, rental_period, currency_code, customer_notes,
    birth_date_snapshot, birthday_discount_amount, birthday_discount_status,
    loyalty_completed_rentals_snapshot, loyalty_discount_amount, loyalty_discount_status
  )
  values (
    v_uid, 'pending', v_period, 'PHP', nullif(p_customer_notes, ''),
    v_birth_date, v_birthday_discount, v_birthday_status,
    v_completed_rentals, v_loyalty_discount, v_loyalty_status
  )
  returning * into v_booking;

  insert into public.booking_items (
    booking_id, product_id, product_name_snapshot, daily_rate_snapshot,
    deposit_per_unit_snapshot, quantity
  )
  values (
    v_booking.id, p_product_id,
    coalesce(nullif(p_product_snapshot ->> 'name', ''), 'Rental item'),
    v_catalog_daily_rate, v_product.refundable_deposit, v_quantity
  )
  returning id into v_item_id;

  insert into public.booking_fulfillments (
    booking_id, method, address_line_1, city_municipality, province,
    delivery_fee_snapshot, recipient_name, contact_number
  )
  values (
    v_booking.id, p_fulfillment_method::public.fulfillment_method,
    v_address_line_1, v_city_municipality, v_province,
    v_delivery_fee,
    nullif(p_customer_snapshot ->> 'fullName', ''),
    nullif(p_customer_snapshot ->> 'phone', '')
  );

  insert into public.booking_status_history (booking_id, from_status, to_status, note, changed_by)
  values (
    v_booking.id, null, 'pending',
    format(
      'Booking created for %s unit(s). Birthday discount: PHP %s. Loyalty discount: PHP %s.',
      v_quantity, v_birthday_discount, v_loyalty_discount
    ),
    v_uid
  );

  if p_emergency_contact is not null then
    insert into public.booking_emergency_contacts (
      booking_id, full_name, relationship, phone_number, address
    )
    values (
      v_booking.id,
      p_emergency_contact ->> 'fullName',
      p_emergency_contact ->> 'relationship',
      p_emergency_contact ->> 'phoneNumber',
      p_emergency_contact ->> 'address'
    );
  end if;

  insert into public.unit_reservations (
    inventory_unit_id, booking_item_id, kind, status, reserved_period, created_by
  )
  select unit_id, v_item_id, 'booking', 'tentative', v_period, v_uid
  from unnest(v_unit_ids) as unit_id;

  perform private.log_audit_event(
    'booking.created', 'booking', v_booking.id::text, v_booking.id,
    null, to_jsonb(v_booking),
    jsonb_build_object(
      'quantity', v_quantity,
      'birthdayDiscount', v_birthday_discount,
      'birthdayDiscountStatus', v_birthday_status,
      'completedRentalsBeforeBooking', v_completed_rentals,
      'loyaltyDiscount', v_loyalty_discount
    ),
    'user'
  );

  return v_booking;
end;
$$;

revoke all on function public.create_booking(
  uuid, date, date, text, text, text, numeric, numeric, jsonb, jsonb, jsonb, text, text, integer
) from public, anon;

grant execute on function public.create_booking(
  uuid, date, date, text, text, text, numeric, numeric, jsonb, jsonb, jsonb, text, text, integer
) to authenticated;

comment on function public.create_booking(
  uuid, date, date, text, text, text, numeric, numeric, jsonb, jsonb, jsonb, text, text, integer
) is 'Creates a booking, atomically reserves units, and applies server-calculated birthday and 11th-rental rewards.';

create or replace view public.booking_totals
with (security_invoker = true)
as
select
  b.id as booking_id,
  upper(b.rental_period) - lower(b.rental_period) as rental_days,
  coalesce(sum(
    bi.quantity::numeric * bi.daily_rate_snapshot *
    (upper(b.rental_period) - lower(b.rental_period))::numeric
  ), 0::numeric)::numeric(12,2) as rental_subtotal,
  coalesce(sum(bi.quantity::numeric * bi.deposit_per_unit_snapshot), 0::numeric)::numeric(12,2) as deposit_total,
  coalesce(bf.delivery_fee_snapshot, 0::numeric)::numeric(12,2) as delivery_fee,
  greatest(
    coalesce(sum(
      bi.quantity::numeric * bi.daily_rate_snapshot *
      (upper(b.rental_period) - lower(b.rental_period))::numeric
    ), 0::numeric)
    + coalesce(sum(bi.quantity::numeric * bi.deposit_per_unit_snapshot), 0::numeric)
    + coalesce(bf.delivery_fee_snapshot, 0::numeric)
    - b.birthday_discount_amount
    - b.loyalty_discount_amount,
    0::numeric
  )::numeric(12,2) as total_amount,
  (b.birthday_discount_amount + b.loyalty_discount_amount)::numeric(12,2) as special_discount_total
from public.bookings b
left join public.booking_items bi on bi.booking_id = b.id
left join public.booking_fulfillments bf on bf.booking_id = b.id
group by
  b.id,
  b.rental_period,
  bf.delivery_fee_snapshot,
  b.birthday_discount_amount,
  b.loyalty_discount_amount;

comment on column public.profiles.birth_date is
  'Renter-provided birth date used only for birthday-month eligibility and verified against submitted identification.';
comment on column public.bookings.birthday_discount_amount is
  'PHP 100 birthday-month discount snapshot, capped by the rental subtotal.';
comment on column public.bookings.loyalty_discount_amount is
  'One-time PHP 200 reward applied after ten completed rentals, making this the rewarded 11th rental.';
