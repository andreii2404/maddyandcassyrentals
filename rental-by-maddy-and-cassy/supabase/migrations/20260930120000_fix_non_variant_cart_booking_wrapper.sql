-- Cart counterpart of 20260928125210_fix_non_variant_single_booking_wrapper.sql.
--
-- create_multi_item_booking() resolved each line's variant by splitting
-- products.specifications ->> 'colors' on commas. For a product with no
-- colors, regexp_split_to_table('', ',') yields one empty row, which matched
-- the empty variant the client sends, so v_variant became '' instead of null.
-- The wrapper then deleted the valid reservation made by
-- create_multi_item_booking_unscoped() and looked for units whose variant
-- equals '' -- none exist (their variant is null) -- and raised
-- NO_VARIANT_AVAILABILITY, shown at checkout as "One of the selected colors is
-- unavailable or does not have enough units." even with free inventory.
--
-- Products without configured colors are fully validated and atomically
-- assigned by the unscoped function, so their reservation is now kept as-is.
-- Color-variant products keep the existing per-variant reallocation.
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
  v_has_colors boolean;
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
    select coalesce(nullif(trim(p.specifications ->> 'colors'), ''), '') <> ''
      into v_has_colors
    from public.products p where p.id = v_item.product_id;

    -- The unscoped function is authoritative for products without configured
    -- variants. Its reservation must not be deleted and reacquired, and any
    -- stale color sent by the client for such a product is ignored.
    if not coalesce(v_has_colors, false) then
      continue;
    end if;

    select elem into v_payload from jsonb_array_elements(p_items) elem
    where (elem ->> 'productId')::uuid = v_item.product_id;

    v_variant := null;
    select trim(value) into v_variant
    from public.products p
    cross join lateral regexp_split_to_table(coalesce(p.specifications ->> 'colors', ''), ',') value
    where p.id = v_item.product_id
      and lower(trim(value)) = lower(trim(coalesce(v_payload ->> 'variant', '')))
    limit 1;

    -- An empty split row (e.g. a trailing comma) is never a real color.
    v_variant := nullif(trim(v_variant), '');

    if v_variant is null then
      raise exception 'VARIANT_NOT_AVAILABLE:%', v_item.product_id;
    end if;

    update public.booking_items set selected_variant = v_variant where id = v_item.id;
    delete from public.unit_reservations where booking_item_id = v_item.id;

    select coalesce(array_agg(candidate.id), '{}'::uuid[]) into v_unit_ids
    from (
      select iu.id from public.inventory_units iu
      where iu.product_id = v_item.product_id
        and iu.lifecycle_status = 'active'
        and lower(trim(iu.variant)) = lower(v_variant)
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
        and lower(trim(iu.variant)) = lower(v_variant);

      if v_total_variant_units < v_item.quantity then
        raise exception 'NO_VARIANT_AVAILABILITY:%:%', v_item.product_id, v_variant;
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
