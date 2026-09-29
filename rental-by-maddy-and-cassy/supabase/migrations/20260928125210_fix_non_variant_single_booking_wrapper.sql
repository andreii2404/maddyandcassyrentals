-- Non-variant products are already fully validated and atomically assigned by
-- create_multi_day_time_based_booking_unscoped(). The variant wrapper was
-- deleting that valid reservation and trying to acquire the same unit again,
-- which could incorrectly raise NO_VARIANT_AVAILABILITY for ordinary products.
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

  -- regexp_split_to_table('', ',') yields one empty row. Treat that as no
  -- variant so ordinary products keep the reservation assigned by the
  -- unscoped booking function.
  v_variant := nullif(trim(v_variant), '');

  if coalesce((select nullif(trim(specifications ->> 'colors'), '') from public.products where id = p_product_id), '') <> ''
     and v_variant is null then
    raise exception 'VARIANT_NOT_AVAILABLE';
  end if;

  v_booking := public.create_multi_day_time_based_booking_unscoped(
    p_product_id, p_pickup_at, p_fulfillment_method, p_location, p_customer_notes,
    p_delivery_fee, p_discount_amount, p_product_snapshot, p_customer_snapshot,
    p_emergency_contact, p_city_municipality, p_province, p_quantity, p_rental_days
  );

  -- The unscoped function is authoritative for products without configured
  -- variants. Its reservation must not be deleted and reacquired.
  if v_variant is null then
    return v_booking;
  end if;

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
      and lower(trim(iu.variant)) = lower(v_variant)
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
      and lower(trim(iu.variant)) = lower(v_variant);

    if v_total_variant_units < p_quantity then
      raise exception 'NO_VARIANT_AVAILABILITY:%:%', p_product_id, v_variant;
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
