-- create_multi_day_time_based_booking() wrote the new multi-day
-- unit_reservations row (reserved_period = full v_period) before updating
-- bookings.rental_period to that same v_period. Between those two
-- statements the booking still carried its original one-day period from
-- create_time_based_booking(), so the reservation and its booking briefly
-- disagreed and tripped the reservation/booking period-match validation on
-- every multi-day (rental_days > 1) booking. Updating the booking first
-- keeps the two always in sync -- no client-visible behavior, pricing, or
-- availability logic changes.

create or replace function public.create_multi_day_time_based_booking(
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
  p_quantity integer default 1,
  p_rental_days integer default 1
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := coalesce(p_rental_days, 1);
  v_quantity integer := coalesce(p_quantity, 1);
  v_booking public.bookings;
  v_item_id uuid;
  v_unit_ids uuid[];
  v_pickup_local_date date;
  v_return_at timestamptz;
  v_next_available_at timestamptz;
  v_reserved_window tstzrange;
  v_period daterange;
begin
  if v_days < 1 or v_days > 30 then
    raise exception 'INVALID_RENTAL_DAYS';
  end if;

  -- Reuse the established booking validation, pricing snapshots, promotions,
  -- address validation, and audit path. This call and the extension below run
  -- in the same transaction, so any later error rolls the complete booking back.
  v_booking := public.create_time_based_booking(
    p_product_id,
    p_pickup_at,
    p_fulfillment_method,
    p_location,
    p_customer_notes,
    p_delivery_fee,
    p_discount_amount,
    p_product_snapshot,
    p_customer_snapshot,
    p_emergency_contact,
    p_city_municipality,
    p_province,
    v_quantity
  );

  if v_days = 1 then
    return v_booking;
  end if;

  select bi.id
    into v_item_id
    from public.booking_items bi
    where bi.booking_id = v_booking.id
    order by bi.created_at, bi.id
    limit 1;

  if v_item_id is null then
    raise exception 'BOOKING_ITEM_REQUIRED';
  end if;

  v_pickup_local_date := (p_pickup_at at time zone 'Asia/Manila')::date;
  v_return_at := p_pickup_at
    + make_interval(hours => 22 + ((v_days - 1) * 24));
  v_next_available_at := v_return_at + interval '2 hours';
  v_reserved_window := tstzrange(p_pickup_at, v_next_available_at, '[)');
  v_period := daterange(v_pickup_local_date, v_pickup_local_date + v_days, '[)');

  -- Lock and assign only units that are available for the complete requested
  -- period. Excluding this booking's temporary one-day reservations lets the
  -- same units remain candidates without weakening the overlap guard.
  select coalesce(array_agg(candidate.id), '{}'::uuid[])
    into v_unit_ids
    from (
      select iu.id
      from public.inventory_units iu
      where iu.product_id = p_product_id
        and iu.lifecycle_status = 'active'
        and not exists (
          select 1
          from public.unit_reservations ur
          where ur.inventory_unit_id = iu.id
            and ur.booking_item_id <> v_item_id
            and ur.status in ('tentative', 'confirmed', 'in_use')
            and ur.reserved_window && v_reserved_window
        )
      order by iu.id
      for update of iu skip locked
      limit v_quantity
    ) candidate;

  if cardinality(v_unit_ids) < v_quantity then
    raise exception 'NO_TIME_AVAILABILITY:%',
      private.next_product_multi_day_pickup_at(
        p_product_id, p_pickup_at, v_quantity, v_days
      )
      using errcode = 'P0001';
  end if;

  -- Extend the booking to the full requested period *before* writing the
  -- matching unit_reservations row below, so the reservation is never
  -- persisted against a stale (still one-day) booking period.
  update public.bookings b
  set rental_period = v_period,
      return_at = v_return_at,
      next_available_at = v_next_available_at
  where b.id = v_booking.id
  returning b.* into v_booking;

  delete from public.unit_reservations ur
  where ur.booking_item_id = v_item_id;

  insert into public.unit_reservations (
    inventory_unit_id, booking_item_id, kind, status,
    reserved_period, reserved_window, created_by
  )
  select unit_id, v_item_id, 'booking', 'tentative',
         v_period, v_reserved_window, auth.uid()
  from unnest(v_unit_ids) as unit_id;

  perform private.log_audit_event(
    'booking.multi_day_period_applied',
    'booking',
    v_booking.id::text,
    v_booking.id,
    null,
    to_jsonb(v_booking),
    jsonb_build_object(
      'rentalDays', v_days,
      'pickupAt', p_pickup_at,
      'returnAt', v_return_at,
      'nextAvailableAt', v_next_available_at
    ),
    'user'
  );

  return v_booking;
exception
  when exclusion_violation then
    raise exception 'NO_TIME_AVAILABILITY:%',
      private.next_product_multi_day_pickup_at(
        p_product_id, p_pickup_at, v_quantity, v_days
      )
      using errcode = 'P0001';
end;
$$;
