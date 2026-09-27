-- Fix a regression from 20260920170448_track_inventory_by_variant.sql: the
-- variant-aware get_product_multi_day_time_availability() stopped computing
-- next_available_at (always returned null instead of the real next open
-- slot), and the variant-scoped booking RPCs raised the same
-- "color unavailable" error for both a genuinely nonexistent variant and a
-- plain scheduling conflict on an existing variant. Neither create_*_booking
-- overload's locking/overlap logic changed -- double-booking was never
-- possible, this only fixes the "when does it open up again" messaging.
--
-- Also adds get_product_variant_reserved_windows(), a read-only RPC the
-- customer booking UI uses to disable/hide already-occupied or
-- preparation-buffer pickup times, instead of only rejecting them after the
-- customer has already picked one.
--
-- Critical fix included here: 20260920170448 added the 5-arg
-- get_product_multi_day_time_availability(..., p_variant) via "create or
-- replace", which in Postgres creates a new overload rather than replacing
-- the pre-existing 4-arg signature (from 20260812/20260823) when the
-- parameter list differs. Both overloads have lived on the database side by
-- side ever since. Every call the client makes for a product with no
-- variant omits p_variant entirely, so PostgREST cannot pick between the two
-- candidates and every such request has failed with PGRST203 ("Could not
-- choose the best candidate function"), surfaced to customers as
-- "Availability check needs another try" with Continue permanently
-- disabled. This drops the stale 4-arg overload so only the 5-arg,
-- variant-aware function remains.
drop function if exists public.get_product_multi_day_time_availability(uuid, timestamptz, integer, integer);

create or replace function private.next_variant_pickup_at(
  p_product_id uuid,
  p_requested_at timestamptz,
  p_quantity integer,
  p_rental_days integer,
  p_variant text
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
        and (
          nullif(trim(p_variant), '') is null
          or lower(trim(iu.variant)) = lower(trim(p_variant))
        )
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
        and (
          nullif(trim(p_variant), '') is null
          or lower(trim(iu.variant)) = lower(trim(p_variant))
        )
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

revoke all on function private.next_variant_pickup_at(uuid, timestamptz, integer, integer, text)
  from public, anon, authenticated;

-- 1. Restore next_available_at on the variant-aware availability RPC.
create or replace function public.get_product_multi_day_time_availability(
  p_product_id uuid,
  p_pickup_at timestamptz,
  p_quantity integer default 1,
  p_rental_days integer default 1,
  p_variant text default null
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
  if p_pickup_at is null then raise exception 'PICKUP_TIME_REQUIRED'; end if;

  if coalesce((
    select nullif(trim(p.specifications ->> 'colors'), '')
    from public.products p
    where p.id = p_product_id
  ), '') <> '' and nullif(trim(p_variant), '') is null then
    raise exception 'VARIANT_REQUIRED';
  end if;

  v_window := tstzrange(p_pickup_at, p_pickup_at + make_interval(days => v_days), '[)');
  select * into v_counts
  from private.count_variant_unit_availability(p_product_id, p_variant, v_window);

  product_id := p_product_id;
  total_units := coalesce(v_counts.total_units, 0);
  available_units := coalesce(v_counts.available_units, 0);
  unavailable_units := greatest(total_units - available_units, 0);
  next_available_at := case
    when available_units >= v_quantity then p_pickup_at
    else private.next_variant_pickup_at(p_product_id, p_pickup_at, v_quantity, v_days, p_variant)
  end;
  pickup_convenience_fee := 0;

  if v_local_time < time '09:00' then
    pickup_convenience_fee := 100;
  elsif v_local_time > time '19:00' then
    v_closing_at := ((p_pickup_at at time zone 'Asia/Manila')::date + time '19:00') at time zone 'Asia/Manila';
    select counts.available_units into v_available_at_closing
    from private.count_variant_unit_availability(
      p_product_id,
      p_variant,
      tstzrange(v_closing_at, v_closing_at + make_interval(days => v_days), '[)')
    ) counts;
    if v_available_at_closing >= v_quantity then pickup_convenience_fee := 100; end if;
  end if;

  return next;
end;
$$;

-- 2. Single-item variant-scoped booking: distinguish "this variant doesn't
-- exist / has no stock" from "this variant is fully booked at this time",
-- and report the real next-available time for the latter, matching the
-- NO_TIME_AVAILABILITY:<time> format submitBookingWithDateGuard parses.
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
  p_rental_days integer default 1,
  p_variant text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_item_id uuid;
  v_variant text;
  v_unit_ids uuid[];
  v_window tstzrange;
  v_period daterange;
  v_total_variant_units integer;
begin
  select trim(value) into v_variant
  from public.products p
  cross join lateral regexp_split_to_table(coalesce(p.specifications ->> 'colors', ''), ',') value
  where p.id = p_product_id and lower(trim(value)) = lower(trim(coalesce(p_variant, '')))
  limit 1;

  if coalesce((select nullif(trim(specifications ->> 'colors'), '') from public.products where id = p_product_id), '') <> ''
     and v_variant is null then
    raise exception 'VARIANT_NOT_AVAILABLE';
  end if;

  v_booking := public.create_multi_day_time_based_booking_unscoped(
    p_product_id, p_pickup_at, p_fulfillment_method, p_location, p_customer_notes,
    p_delivery_fee, p_discount_amount, p_product_snapshot, p_customer_snapshot,
    p_emergency_contact, p_city_municipality, p_province, p_quantity, p_rental_days
  );

  select id into v_item_id from public.booking_items
  where booking_id = v_booking.id and product_id = p_product_id;
  update public.booking_items set selected_variant = v_variant where id = v_item_id;
  delete from public.unit_reservations where booking_item_id = v_item_id;

  v_window := tstzrange(p_pickup_at, p_pickup_at + make_interval(days => p_rental_days), '[)');
  v_period := daterange((p_pickup_at at time zone 'Asia/Manila')::date,
    (p_pickup_at at time zone 'Asia/Manila')::date + p_rental_days, '[)');

  select coalesce(array_agg(candidate.id), '{}'::uuid[]) into v_unit_ids
  from (
    select iu.id from public.inventory_units iu
    where iu.product_id = p_product_id
      and iu.lifecycle_status = 'active'
      and (v_variant is null or lower(trim(iu.variant)) = lower(v_variant))
      and not exists (
        select 1 from public.unit_reservations ur
        where ur.inventory_unit_id = iu.id
          and ur.status in ('tentative', 'confirmed', 'in_use')
          and ur.reserved_window && v_window
      )
    order by iu.id for update of iu skip locked limit p_quantity
  ) candidate;

  if cardinality(v_unit_ids) < p_quantity then
    select count(*)::integer into v_total_variant_units
    from public.inventory_units iu
    where iu.product_id = p_product_id
      and iu.lifecycle_status = 'active'
      and (v_variant is null or lower(trim(iu.variant)) = lower(v_variant));

    if v_total_variant_units < p_quantity then
      raise exception 'NO_VARIANT_AVAILABILITY:%:%', p_product_id, coalesce(v_variant, '');
    end if;

    raise exception 'NO_TIME_AVAILABILITY:%',
      private.next_variant_pickup_at(p_product_id, p_pickup_at, p_quantity, p_rental_days, v_variant);
  end if;

  insert into public.unit_reservations (
    inventory_unit_id, booking_item_id, kind, status, reserved_period, reserved_window, created_by
  ) select unit_id, v_item_id, 'booking', 'tentative', v_period, v_window, auth.uid()
    from unnest(v_unit_ids) unit_id;
  return v_booking;
end;
$$;

-- 3. Cart booking: same NO_VARIANT_AVAILABILITY vs NO_TIME_AVAILABILITY
-- split per line, keeping the existing NO_TIME_AVAILABILITY:<productId>:<time>
-- format submitMultiItemBookingWithDateGuard already parses.
create or replace function public.create_multi_item_booking(
  p_items jsonb,
  p_pickup_at timestamptz,
  p_rental_days integer,
  p_fulfillment_method text,
  p_location text,
  p_city_municipality text,
  p_province text,
  p_customer_notes text,
  p_delivery_fee numeric,
  p_customer_snapshot jsonb,
  p_emergency_contact jsonb default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_item record;
  v_payload jsonb;
  v_variant text;
  v_unit_ids uuid[];
  v_window tstzrange := tstzrange(p_pickup_at, p_pickup_at + make_interval(days => p_rental_days), '[)');
  v_period daterange := daterange((p_pickup_at at time zone 'Asia/Manila')::date,
    (p_pickup_at at time zone 'Asia/Manila')::date + p_rental_days, '[)');
  v_total_variant_units integer;
begin
  v_booking := public.create_multi_item_booking_unscoped(
    p_items, p_pickup_at, p_rental_days, p_fulfillment_method, p_location,
    p_city_municipality, p_province, p_customer_notes, p_delivery_fee,
    p_customer_snapshot, p_emergency_contact
  );

  for v_item in
    select bi.id, bi.product_id, bi.quantity
    from public.booking_items bi where bi.booking_id = v_booking.id
    order by bi.product_id
  loop
    select elem into v_payload from jsonb_array_elements(p_items) elem
    where (elem ->> 'productId')::uuid = v_item.product_id;
    v_variant := null;
    select trim(value) into v_variant
    from public.products p
    cross join lateral regexp_split_to_table(coalesce(p.specifications ->> 'colors', ''), ',') value
    where p.id = v_item.product_id
      and lower(trim(value)) = lower(trim(coalesce(v_payload ->> 'variant', '')))
    limit 1;

    if coalesce((select nullif(trim(specifications ->> 'colors'), '') from public.products where id = v_item.product_id), '') <> ''
       and v_variant is null then
      raise exception 'VARIANT_NOT_AVAILABLE:%', v_item.product_id;
    end if;

    update public.booking_items set selected_variant = v_variant where id = v_item.id;
    delete from public.unit_reservations where booking_item_id = v_item.id;

    select coalesce(array_agg(candidate.id), '{}'::uuid[]) into v_unit_ids
    from (
      select iu.id from public.inventory_units iu
      where iu.product_id = v_item.product_id
        and iu.lifecycle_status = 'active'
        and (v_variant is null or lower(trim(iu.variant)) = lower(v_variant))
        and not exists (
          select 1 from public.unit_reservations ur
          where ur.inventory_unit_id = iu.id
            and ur.status in ('tentative', 'confirmed', 'in_use')
            and ur.reserved_window && v_window
        )
      order by iu.id for update of iu skip locked limit v_item.quantity
    ) candidate;

    if cardinality(v_unit_ids) < v_item.quantity then
      select count(*)::integer into v_total_variant_units
      from public.inventory_units iu
      where iu.product_id = v_item.product_id
        and iu.lifecycle_status = 'active'
        and (v_variant is null or lower(trim(iu.variant)) = lower(v_variant));

      if v_total_variant_units < v_item.quantity then
        raise exception 'NO_VARIANT_AVAILABILITY:%:%', v_item.product_id, coalesce(v_variant, '');
      end if;

      raise exception 'NO_TIME_AVAILABILITY:%:%', v_item.product_id,
        private.next_variant_pickup_at(v_item.product_id, p_pickup_at, v_item.quantity, p_rental_days, v_variant);
    end if;

    insert into public.unit_reservations (
      inventory_unit_id, booking_item_id, kind, status, reserved_period, reserved_window, created_by
    ) select unit_id, v_item.id, 'booking', 'tentative', v_period, v_window, auth.uid()
      from unnest(v_unit_ids) unit_id;
  end loop;
  return v_booking;
end;
$$;

-- 4. New: exposes each blocking reserved_window (already inclusive of the
-- 2-hour turnaround baked into reserved_window by create_multi_day_time_based_booking)
-- for a product/variant, so the booking UI can disable/hide occupied and
-- buffer-blocked pickup times client-side instead of only rejecting a pick
-- after the fact. UX-only, same non-atomic caveat as
-- get_product_availability_calendar: the create_*_booking RPCs remain the
-- authoritative, row-locked guard.
create or replace function public.get_product_variant_reserved_windows(
  p_product_id uuid,
  p_variant text,
  p_window_start timestamptz,
  p_window_end timestamptz
)
returns table (
  total_units bigint,
  windows jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with matching_units as (
    select iu.id
    from public.inventory_units iu
    where iu.product_id = p_product_id
      and iu.lifecycle_status = 'active'
      and (
        nullif(trim(p_variant), '') is null
        or lower(trim(iu.variant)) = lower(trim(p_variant))
      )
  )
  select
    (select count(*) from matching_units)::bigint as total_units,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'unitId', ur.inventory_unit_id,
          'start', lower(ur.reserved_window),
          'end', upper(ur.reserved_window)
        ))
        from public.unit_reservations ur
        where ur.inventory_unit_id in (select id from matching_units)
          and ur.status in ('tentative', 'confirmed', 'in_use')
          and ur.reserved_window && tstzrange(p_window_start, p_window_end, '[)')
      ),
      '[]'::jsonb
    ) as windows;
$$;

revoke all on function public.get_product_variant_reserved_windows(uuid, text, timestamptz, timestamptz)
  from public;
grant execute on function public.get_product_variant_reserved_windows(uuid, text, timestamptz, timestamptz)
  to anon, authenticated;

comment on function public.get_product_variant_reserved_windows(uuid, text, timestamptz, timestamptz) is
  'Returns the active-unit total and every blocking reserved_window (inclusive of the 2-hour turnaround) for a product/variant within a date window, for client-side pickup-time slot disabling. Non-atomic UX hint only -- the create_*_booking RPCs re-check with row locks at submission time.';
