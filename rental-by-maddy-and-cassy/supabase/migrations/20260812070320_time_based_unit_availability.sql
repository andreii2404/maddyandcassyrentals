-- Reserve physical units by exact Manila pickup timestamp. Every 22-hour
-- rental protects the unit for a further two-hour preparation window.

create extension if not exists btree_gist with schema extensions;

alter table public.bookings
  add column pickup_at timestamptz,
  add column return_at timestamptz,
  add column next_available_at timestamptz;

alter table public.booking_fulfillments
  add column pickup_convenience_fee_snapshot numeric(12,2) not null default 0,
  add constraint booking_fulfillments_pickup_convenience_fee_nonnegative
    check (pickup_convenience_fee_snapshot >= 0);

alter table public.unit_reservations
  add column reserved_window tstzrange;

-- Preserve existing reservations. Legacy multi-day bookings are interpreted
-- as a 9:00 AM pickup with a 22-hour final rental day and two-hour turnaround.
update public.bookings b
set pickup_at = (lower(b.rental_period)::timestamp + interval '9 hours') at time zone 'Asia/Manila',
    return_at = (
      lower(b.rental_period)::timestamp + interval '9 hours'
      + ((upper(b.rental_period) - lower(b.rental_period)) * interval '1 day')
      - interval '2 hours'
    ) at time zone 'Asia/Manila',
    next_available_at = (
      lower(b.rental_period)::timestamp + interval '9 hours'
      + ((upper(b.rental_period) - lower(b.rental_period)) * interval '1 day')
    ) at time zone 'Asia/Manila'
where b.pickup_at is null;

update public.unit_reservations ur
set reserved_window = coalesce(
  (
    select tstzrange(b.pickup_at, b.next_available_at, '[)')
    from public.booking_items bi
    join public.bookings b on b.id = bi.booking_id
    where bi.id = ur.booking_item_id
  ),
  tstzrange(
    lower(ur.reserved_period)::timestamp at time zone 'Asia/Manila',
    upper(ur.reserved_period)::timestamp at time zone 'Asia/Manila',
    '[)'
  )
)
where ur.reserved_window is null;

-- Keep the previous date-only RPC operational during rolling deployments.
-- New application code always supplies exact timestamps; legacy inserts are
-- conservatively translated to 9:00 AM scheduling by these compatibility
-- triggers so they cannot bypass the timestamp exclusion constraint.
create or replace function private.set_booking_exact_timing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.pickup_at is null then
    new.pickup_at := (
      lower(new.rental_period)::timestamp + interval '9 hours'
    ) at time zone 'Asia/Manila';
  end if;
  new.return_at := coalesce(
    new.return_at,
    new.pickup_at
      + ((upper(new.rental_period) - lower(new.rental_period)) * interval '1 day')
      - interval '2 hours'
  );
  new.next_available_at := coalesce(new.next_available_at, new.return_at + interval '2 hours');
  return new;
end;
$$;

revoke all on function private.set_booking_exact_timing() from public, anon, authenticated;

create trigger set_booking_exact_timing
before insert or update of rental_period, pickup_at, return_at, next_available_at
on public.bookings
for each row execute function private.set_booking_exact_timing();

create or replace function private.set_unit_reservation_window()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.reserved_window is null then
    select tstzrange(b.pickup_at, b.next_available_at, '[)')
      into new.reserved_window
      from public.booking_items bi
      join public.bookings b on b.id = bi.booking_id
      where bi.id = new.booking_item_id;

    new.reserved_window := coalesce(
      new.reserved_window,
      tstzrange(
        lower(new.reserved_period)::timestamp at time zone 'Asia/Manila',
        upper(new.reserved_period)::timestamp at time zone 'Asia/Manila',
        '[)'
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function private.set_unit_reservation_window() from public, anon, authenticated;

create trigger set_unit_reservation_window
before insert or update of booking_item_id, reserved_period, reserved_window
on public.unit_reservations
for each row execute function private.set_unit_reservation_window();

alter table public.bookings
  alter column pickup_at set not null,
  alter column return_at set not null,
  alter column next_available_at set not null,
  add constraint bookings_exact_rental_timing_valid check (
    return_at = pickup_at
      + ((upper(rental_period) - lower(rental_period)) * interval '1 day')
      - interval '2 hours'
    and next_available_at = return_at + interval '2 hours'
  );

alter table public.unit_reservations
  alter column reserved_window set not null,
  add constraint unit_reservations_reserved_window_nonempty
    check (not isempty(reserved_window));

alter table public.unit_reservations
  add constraint unit_reservations_no_active_time_overlap
  exclude using gist (
    inventory_unit_id with =,
    reserved_window with &&
  )
  where (status in ('tentative', 'confirmed', 'in_use'));

create index unit_reservations_inventory_window_idx
  on public.unit_reservations using gist (inventory_unit_id, reserved_window);

create or replace function private.next_product_pickup_at(
  p_product_id uuid,
  p_requested_at timestamptz,
  p_quantity integer
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidate timestamptz := p_requested_at;
  v_available integer;
  v_next_change timestamptz;
begin
  loop
    select count(*)::integer
      into v_available
      from public.inventory_units iu
      where iu.product_id = p_product_id
        and iu.lifecycle_status = 'active'
        and not exists (
          select 1
          from public.unit_reservations ur
          where ur.inventory_unit_id = iu.id
            and ur.status in ('tentative', 'confirmed', 'in_use')
            and ur.reserved_window && tstzrange(v_candidate, v_candidate + interval '24 hours', '[)')
        );

    if v_available >= p_quantity then
      return v_candidate;
    end if;

    select min(upper(ur.reserved_window))
      into v_next_change
      from public.unit_reservations ur
      join public.inventory_units iu on iu.id = ur.inventory_unit_id
      where iu.product_id = p_product_id
        and iu.lifecycle_status = 'active'
        and ur.status in ('tentative', 'confirmed', 'in_use')
        and ur.reserved_window && tstzrange(v_candidate, v_candidate + interval '24 hours', '[)')
        and upper(ur.reserved_window) > v_candidate;

    if v_next_change is null then
      return null;
    end if;
    v_candidate := v_next_change;
  end loop;
end;
$$;

revoke all on function private.next_product_pickup_at(uuid, timestamptz, integer)
  from public, anon, authenticated;

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
  v_available_at_closing integer := 0;
begin
  if p_pickup_at is null then
    raise exception 'PICKUP_TIME_REQUIRED';
  end if;

  select count(*)::integer,
         count(*) filter (where not exists (
           select 1
           from public.unit_reservations ur
           where ur.inventory_unit_id = iu.id
             and ur.status in ('tentative', 'confirmed', 'in_use')
             and ur.reserved_window && v_window
         ))::integer
    into total_units, available_units
    from public.inventory_units iu
    where iu.product_id = p_product_id
      and iu.lifecycle_status = 'active';

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

    select count(*)::integer
      into v_available_at_closing
      from public.inventory_units iu
      where iu.product_id = p_product_id
        and iu.lifecycle_status = 'active'
        and not exists (
          select 1
          from public.unit_reservations ur
          where ur.inventory_unit_id = iu.id
            and ur.status in ('tentative', 'confirmed', 'in_use')
            and ur.reserved_window && tstzrange(v_closing_at, v_closing_at + interval '24 hours', '[)')
        );

    -- A later time suggested by unit availability is not a voluntary
    -- outside-hours request, so it must not receive the convenience fee.
    if v_available_at_closing >= v_quantity then
      pickup_convenience_fee := 100;
    end if;
  end if;

  return next;
end;
$$;

revoke all on function public.get_product_time_availability(uuid, timestamptz, integer)
  from public;
grant execute on function public.get_product_time_availability(uuid, timestamptz, integer)
  to anon, authenticated;

create or replace function public.create_time_based_booking(
  p_product_id uuid,
  p_pickup_at timestamptz,
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
  v_quantity integer;
  v_pickup_local_date date;
  v_pickup_local_time time;
  v_return_at timestamptz;
  v_next_available_at timestamptz;
  v_reserved_window tstzrange;
  v_period daterange;
  v_catalog_daily_rate numeric(12,2);
  v_catalog_subtotal numeric(12,2);
  v_delivery_fee numeric(12,2);
  v_convenience_fee numeric(12,2) := 0;
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

  if p_pickup_at is null then
    raise exception 'PICKUP_TIME_REQUIRED';
  end if;
  if p_pickup_at < now() then
    raise exception 'PICKUP_TIME_IN_PAST';
  end if;

  select pr.birth_date, pr.birth_date_verified_at
    into v_birth_date, v_birth_date_verified_at
    from public.profiles pr
    where pr.id = v_uid and pr.account_status <> 'suspended'
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

  if p_fulfillment_method = 'delivery' then
    v_address_line_1 := nullif(trim(both from coalesce(p_location, '')), '');
    v_city_municipality := nullif(trim(both from coalesce(p_city_municipality, '')), '');
    v_province := nullif(trim(both from coalesce(p_province, '')), '');
    if v_address_line_1 is null or v_city_municipality is null or v_province is null then
      raise exception 'DELIVERY_ADDRESS_REQUIRED';
    end if;
  end if;

  select id, daily_rate, refundable_deposit, specifications, status
    into v_product
    from public.products
    where id = p_product_id
    for share;
  if v_product.id is null or v_product.status <> 'active' then
    raise exception 'PRODUCT_NOT_AVAILABLE';
  end if;

  v_pickup_local_date := (p_pickup_at at time zone 'Asia/Manila')::date;
  v_pickup_local_time := (p_pickup_at at time zone 'Asia/Manila')::time;
  v_return_at := p_pickup_at + interval '22 hours';
  v_next_available_at := v_return_at + interval '2 hours';
  v_reserved_window := tstzrange(p_pickup_at, v_next_available_at, '[)');
  v_period := daterange(v_pickup_local_date, v_pickup_local_date + 1, '[)');

  v_discount_text := nullif(v_product.specifications ->> 'discountPercent', '');
  if v_discount_text is not null and v_discount_text ~ '^([0-9]+)(\.[0-9]+)?$' then
    v_discount_percent := least(greatest(v_discount_text::numeric, 0), 90);
  end if;
  v_catalog_daily_rate := round(v_product.daily_rate * (1 - (v_discount_percent / 100)), 2);
  v_catalog_subtotal := v_catalog_daily_rate * v_quantity;
  v_delivery_fee := case when p_fulfillment_method = 'delivery'
    then greatest(coalesce(p_delivery_fee, 0), 0) else 0 end;

  if p_fulfillment_method = 'pickup' and v_pickup_local_time < time '09:00' then
    v_convenience_fee := 100;
  elsif p_fulfillment_method = 'pickup' and v_pickup_local_time > time '19:00' then
    select pickup_convenience_fee into v_convenience_fee
    from public.get_product_time_availability(p_product_id, p_pickup_at, v_quantity);
  end if;

  if v_birth_date is not null
    and extract(month from v_pickup_local_date) = extract(month from v_birth_date)
  then
    v_birthday_discount := least(100, v_catalog_subtotal);
    v_birthday_status := case when v_birth_date_verified_at is null
      then 'pending_verification' else 'verified' end;
  end if;

  select count(*)::integer into v_completed_rentals
  from public.bookings prior
  where prior.customer_id = v_uid and prior.status = 'returned';

  select exists (
    select 1 from public.bookings reward_booking
    where reward_booking.customer_id = v_uid
      and reward_booking.loyalty_discount_amount > 0
      and reward_booking.status <> 'cancelled'
  ) into v_loyalty_reward_used;

  if v_completed_rentals >= 10 and not v_loyalty_reward_used then
    v_loyalty_discount := least(200, greatest(v_catalog_subtotal - v_birthday_discount, 0));
    if v_loyalty_discount > 0 then v_loyalty_status := 'applied'; end if;
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
            and ur.reserved_window && v_reserved_window
        )
      order by iu.id
      for update of iu skip locked
      limit v_quantity
    ) candidate;

  if cardinality(v_unit_ids) < v_quantity then
    raise exception 'NO_TIME_AVAILABILITY:%',
      private.next_product_pickup_at(p_product_id, p_pickup_at, v_quantity)
      using errcode = 'P0001';
  end if;

  insert into public.bookings (
    customer_id, status, rental_period, pickup_at, return_at, next_available_at,
    currency_code, customer_notes, birth_date_snapshot,
    birthday_discount_amount, birthday_discount_status,
    loyalty_completed_rentals_snapshot, loyalty_discount_amount, loyalty_discount_status
  ) values (
    v_uid, 'pending', v_period, p_pickup_at, v_return_at, v_next_available_at,
    'PHP', nullif(p_customer_notes, ''), v_birth_date,
    v_birthday_discount, v_birthday_status,
    v_completed_rentals, v_loyalty_discount, v_loyalty_status
  ) returning * into v_booking;

  insert into public.booking_items (
    booking_id, product_id, product_name_snapshot, daily_rate_snapshot,
    deposit_per_unit_snapshot, quantity
  ) values (
    v_booking.id, p_product_id,
    coalesce(nullif(p_product_snapshot ->> 'name', ''), 'Rental item'),
    v_catalog_daily_rate, v_product.refundable_deposit, v_quantity
  ) returning id into v_item_id;

  insert into public.booking_fulfillments (
    booking_id, method, address_line_1, city_municipality, province,
    delivery_fee_snapshot, pickup_convenience_fee_snapshot,
    recipient_name, contact_number
  ) values (
    v_booking.id, p_fulfillment_method::public.fulfillment_method,
    v_address_line_1, v_city_municipality, v_province,
    v_delivery_fee, v_convenience_fee,
    nullif(p_customer_snapshot ->> 'fullName', ''),
    nullif(p_customer_snapshot ->> 'phone', '')
  );

  insert into public.booking_status_history (booking_id, from_status, to_status, note, changed_by)
  values (
    v_booking.id, null, 'pending',
    format('Booking created for %s unit(s), pickup %s, return %s.',
      v_quantity, p_pickup_at, v_return_at),
    v_uid
  );

  if p_emergency_contact is not null then
    insert into public.booking_emergency_contacts (
      booking_id, full_name, relationship, phone_number, address
    ) values (
      v_booking.id, p_emergency_contact ->> 'fullName',
      p_emergency_contact ->> 'relationship',
      p_emergency_contact ->> 'phoneNumber',
      p_emergency_contact ->> 'address'
    );
  end if;

  insert into public.unit_reservations (
    inventory_unit_id, booking_item_id, kind, status,
    reserved_period, reserved_window, created_by
  )
  select unit_id, v_item_id, 'booking', 'tentative',
         v_period, v_reserved_window, v_uid
  from unnest(v_unit_ids) as unit_id;

  perform private.log_audit_event(
    'booking.created', 'booking', v_booking.id::text, v_booking.id,
    null, to_jsonb(v_booking),
    jsonb_build_object(
      'quantity', v_quantity,
      'pickupAt', p_pickup_at,
      'returnAt', v_return_at,
      'nextAvailableAt', v_next_available_at,
      'pickupConvenienceFee', v_convenience_fee
    ),
    'user'
  );

  return v_booking;
exception
  when exclusion_violation then
    raise exception 'NO_TIME_AVAILABILITY:%',
      private.next_product_pickup_at(p_product_id, p_pickup_at, v_quantity)
      using errcode = 'P0001';
end;
$$;

revoke all on function public.create_time_based_booking(
  uuid, timestamptz, text, text, text, numeric, numeric, jsonb, jsonb,
  jsonb, text, text, integer
) from public, anon;
grant execute on function public.create_time_based_booking(
  uuid, timestamptz, text, text, text, numeric, numeric, jsonb, jsonb,
  jsonb, text, text, integer
) to authenticated;

create or replace view public.booking_totals
with (security_invoker = true)
as
select
  b.id as booking_id,
  upper(b.rental_period) - lower(b.rental_period) as rental_days,
  coalesce(sum(
    bi.quantity::numeric * bi.daily_rate_snapshot
      * (upper(b.rental_period) - lower(b.rental_period))::numeric
  ), 0::numeric)::numeric(12,2)
    as rental_subtotal,
  coalesce(sum(bi.quantity::numeric * bi.deposit_per_unit_snapshot), 0::numeric)::numeric(12,2)
    as deposit_total,
  coalesce(bf.delivery_fee_snapshot, 0::numeric)::numeric(12,2) as delivery_fee,
  greatest(
    coalesce(sum(
      bi.quantity::numeric * bi.daily_rate_snapshot
        * (upper(b.rental_period) - lower(b.rental_period))::numeric
    ), 0::numeric)
    + coalesce(sum(bi.quantity::numeric * bi.deposit_per_unit_snapshot), 0::numeric)
    + coalesce(bf.delivery_fee_snapshot, 0::numeric)
    + coalesce(bf.pickup_convenience_fee_snapshot, 0::numeric)
    - b.birthday_discount_amount
    - b.loyalty_discount_amount,
    0::numeric
  )::numeric(12,2) as total_amount,
  (b.birthday_discount_amount + b.loyalty_discount_amount)::numeric(12,2)
    as special_discount_total,
  coalesce(bf.pickup_convenience_fee_snapshot, 0::numeric)::numeric(12,2)
    as pickup_convenience_fee
from public.bookings b
left join public.booking_items bi on bi.booking_id = b.id
left join public.booking_fulfillments bf on bf.booking_id = b.id
group by b.id, bf.delivery_fee_snapshot, bf.pickup_convenience_fee_snapshot,
  b.rental_period, b.birthday_discount_amount, b.loyalty_discount_amount;

comment on column public.bookings.pickup_at is
  'Exact scheduled pickup timestamp. Customer-entered local time is converted from Asia/Manila.';
comment on column public.bookings.return_at is
  'Automatically calculated as pickup_at plus the 22-hour rental duration.';
comment on column public.bookings.next_available_at is
  'Automatically calculated as return_at plus the two-hour preparation window.';
comment on column public.unit_reservations.reserved_window is
  'Protected exact timestamp range from pickup through return and turnaround; upper bound is exclusive.';
