-- Allow customers to select a contiguous one-to-thirty-day rental period.
-- A one-day booking remains 22 hours. Each additional selected day adds
-- 24 hours, and the final two hours remain reserved for preparation.

create or replace function private.next_product_multi_day_pickup_at(
  p_product_id uuid,
  p_requested_at timestamptz,
  p_quantity integer,
  p_rental_days integer
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
  v_days integer := least(greatest(coalesce(p_rental_days, 1), 1), 30);
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
            and ur.reserved_window && tstzrange(
              v_candidate,
              v_candidate + make_interval(days => v_days),
              '[)'
            )
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
        and ur.reserved_window && tstzrange(
          v_candidate,
          v_candidate + make_interval(days => v_days),
          '[)'
        )
        and upper(ur.reserved_window) > v_candidate;

    if v_next_change is null then
      return null;
    end if;
    v_candidate := v_next_change;
  end loop;
end;
$$;

revoke all on function private.next_product_multi_day_pickup_at(uuid, timestamptz, integer, integer)
  from public, anon, authenticated;

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
  v_available_at_closing integer := 0;
begin
  if p_pickup_at is null then
    raise exception 'PICKUP_TIME_REQUIRED';
  end if;

  v_window := tstzrange(
    p_pickup_at,
    p_pickup_at + make_interval(days => v_days),
    '[)'
  );

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
    else private.next_product_multi_day_pickup_at(
      p_product_id, p_pickup_at, v_quantity, v_days
    )
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
            and ur.reserved_window && tstzrange(
              v_closing_at,
              v_closing_at + make_interval(days => v_days),
              '[)'
            )
        );

    if v_available_at_closing >= v_quantity then
      pickup_convenience_fee := 100;
    end if;
  end if;

  return next;
end;
$$;

revoke all on function public.get_product_multi_day_time_availability(uuid, timestamptz, integer, integer)
  from public;
grant execute on function public.get_product_multi_day_time_availability(uuid, timestamptz, integer, integer)
  to anon, authenticated;

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

  delete from public.unit_reservations ur
  where ur.booking_item_id = v_item_id;

  insert into public.unit_reservations (
    inventory_unit_id, booking_item_id, kind, status,
    reserved_period, reserved_window, created_by
  )
  select unit_id, v_item_id, 'booking', 'tentative',
         v_period, v_reserved_window, auth.uid()
  from unnest(v_unit_ids) as unit_id;

  update public.bookings b
  set rental_period = v_period,
      return_at = v_return_at,
      next_available_at = v_next_available_at
  where b.id = v_booking.id
  returning b.* into v_booking;

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

revoke all on function public.create_multi_day_time_based_booking(
  uuid, timestamptz, text, text, text, numeric, numeric, jsonb, jsonb,
  jsonb, text, text, integer, integer
) from public, anon;
grant execute on function public.create_multi_day_time_based_booking(
  uuid, timestamptz, text, text, text, numeric, numeric, jsonb, jsonb,
  jsonb, text, text, integer, integer
) to authenticated;

comment on function public.create_multi_day_time_based_booking(
  uuid, timestamptz, text, text, text, numeric, numeric, jsonb, jsonb,
  jsonb, text, text, integer, integer
) is 'Creates a one-to-thirty-day booking and atomically protects the selected units through the final two-hour turnaround.';
