-- Inventory is physically assigned per color/variant. Product-level totals
-- remain useful for catalog summaries, but reservation limits and allocation
-- must use only units matching the customer's selected variant.

alter table public.inventory_units
  add column if not exists variant text;

alter table public.booking_items
  add column if not exists selected_variant text;

create index if not exists inventory_units_product_variant_active_idx
  on public.inventory_units (product_id, lower(variant))
  where lifecycle_status = 'active';

comment on column public.inventory_units.variant is
  'Customer-facing physical variant (for example color). Null only for products without variants.';
comment on column public.booking_items.selected_variant is
  'Variant requested by the customer and enforced during physical-unit assignment.';

-- Map the existing consolidated phone inventory to its actual colors. The
-- second iPhone 13 Pro row represented the unavailable Blue listing, not a
-- rentable active unit, so it remains recorded but is placed in maintenance.
update public.inventory_units iu
set variant = mapping.variant,
    lifecycle_status = mapping.lifecycle_status::public.unit_lifecycle_status,
    updated_at = now()
from (values
  ('IP17PM-01', 'Blue',   'active'),
  ('IP17PM-02', 'Orange', 'active'),
  ('IP17PM-03', 'Silver', 'maintenance'),
  ('IP13P-01',  'Black',  'active'),
  ('IP13P-02',  'Blue',   'maintenance')
) as mapping(unit_code, variant, lifecycle_status)
where iu.unit_code = mapping.unit_code
  and exists (
    select 1 from public.products p
    where p.id = iu.product_id
      and p.name in ('iPhone 17 Pro Max', 'iPhone 13 Pro')
  );

create or replace function private.count_variant_unit_availability(
  p_product_id uuid,
  p_variant text,
  p_window tstzrange
)
returns table (total_units bigint, available_units bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::bigint,
    count(*) filter (
      where not exists (
        select 1
        from public.unit_reservations ur
        where ur.inventory_unit_id = iu.id
          and ur.status in ('tentative', 'confirmed', 'in_use')
          and ur.reserved_window && p_window
      )
    )::bigint
  from public.inventory_units iu
  where iu.product_id = p_product_id
    and iu.lifecycle_status = 'active'
    and (
      nullif(trim(p_variant), '') is null
      or lower(trim(iu.variant)) = lower(trim(p_variant))
    );
$$;

revoke all on function private.count_variant_unit_availability(uuid, text, tstzrange)
  from public, anon, authenticated;

create or replace function public.get_product_variant_availability(
  p_product_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (variant text, total_units bigint, available_units bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with options as (
    select trim(value) as variant
    from public.products p
    cross join lateral regexp_split_to_table(coalesce(p.specifications ->> 'colors', ''), ',') value
    where p.id = p_product_id and trim(value) <> ''
  ), requested_window as (
    select tstzrange(
      (p_start_date::timestamp) at time zone 'Asia/Manila',
      ((p_end_date + 1)::timestamp) at time zone 'Asia/Manila',
      '[)'
    ) as value
  )
  select o.variant, counts.total_units, counts.available_units
  from options o
  cross join requested_window w
  cross join lateral private.count_variant_unit_availability(p_product_id, o.variant, w.value) counts
  order by o.variant;
$$;

revoke all on function public.get_product_variant_availability(uuid, date, date) from public;
grant execute on function public.get_product_variant_availability(uuid, date, date) to anon, authenticated;

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
  next_available_at := case when available_units >= v_quantity then p_pickup_at else null end;
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

revoke all on function public.get_product_multi_day_time_availability(uuid, timestamptz, integer, integer, text) from public;
grant execute on function public.get_product_multi_day_time_availability(uuid, timestamptz, integer, integer, text) to anon, authenticated;

-- Preserve the established pricing/customer/booking behavior, then replace
-- its generic unit assignment inside the same transaction with variant-bound
-- rows. Any shortfall raises and rolls the entire booking back.
alter function public.create_multi_day_time_based_booking(
  uuid, timestamptz, text, text, text, numeric, numeric, jsonb, jsonb, jsonb,
  text, text, integer, integer
) rename to create_multi_day_time_based_booking_unscoped;

revoke all on function public.create_multi_day_time_based_booking_unscoped(
  uuid, timestamptz, text, text, text, numeric, numeric, jsonb, jsonb, jsonb,
  text, text, integer, integer
) from public, anon, authenticated;

create function public.create_multi_day_time_based_booking(
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
    raise exception 'NO_VARIANT_AVAILABILITY:%:%', p_product_id, coalesce(v_variant, '');
  end if;

  insert into public.unit_reservations (
    inventory_unit_id, booking_item_id, kind, status, reserved_period, reserved_window, created_by
  ) select unit_id, v_item_id, 'booking', 'tentative', v_period, v_window, auth.uid()
    from unnest(v_unit_ids) unit_id;
  return v_booking;
end;
$$;

revoke all on function public.create_multi_day_time_based_booking(
  uuid, timestamptz, text, text, text, numeric, numeric, jsonb, jsonb, jsonb,
  text, text, integer, integer, text
) from public, anon;
grant execute on function public.create_multi_day_time_based_booking(
  uuid, timestamptz, text, text, text, numeric, numeric, jsonb, jsonb, jsonb,
  text, text, integer, integer, text
) to authenticated;

-- Keep the previous RPC signature available for an older frontend during a
-- rolling deploy. It remains safe: variant products are rejected rather than
-- silently falling back to aggregate inventory, while non-variant products
-- delegate to the variant-aware implementation unchanged.
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
  v_has_variants boolean;
begin
  select coalesce(nullif(trim(p.specifications ->> 'colors'), '') <> '', false)
    into v_has_variants
  from public.products p
  where p.id = p_product_id;

  if coalesce(v_has_variants, false) then
    raise exception 'VARIANT_REQUIRED';
  end if;

  return public.create_multi_day_time_based_booking(
    p_product_id, p_pickup_at, p_fulfillment_method, p_location,
    p_customer_notes, p_delivery_fee, p_discount_amount, p_product_snapshot,
    p_customer_snapshot, p_emergency_contact, p_city_municipality,
    p_province, p_quantity, p_rental_days, null
  );
end;
$$;

revoke all on function public.create_multi_day_time_based_booking(
  uuid, timestamptz, text, text, text, numeric, numeric, jsonb, jsonb, jsonb,
  text, text, integer, integer
) from public, anon;
grant execute on function public.create_multi_day_time_based_booking(
  uuid, timestamptz, text, text, text, numeric, numeric, jsonb, jsonb, jsonb,
  text, text, integer, integer
) to authenticated;

alter function public.create_multi_item_booking(
  jsonb, timestamptz, integer, text, text, text, text, text, numeric, jsonb, jsonb
) rename to create_multi_item_booking_unscoped;

revoke all on function public.create_multi_item_booking_unscoped(
  jsonb, timestamptz, integer, text, text, text, text, text, numeric, jsonb, jsonb
) from public, anon, authenticated;

create function public.create_multi_item_booking(
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
      raise exception 'NO_VARIANT_AVAILABILITY:%:%', v_item.product_id, coalesce(v_variant, '');
    end if;

    insert into public.unit_reservations (
      inventory_unit_id, booking_item_id, kind, status, reserved_period, reserved_window, created_by
    ) select unit_id, v_item.id, 'booking', 'tentative', v_period, v_window, auth.uid()
      from unnest(v_unit_ids) unit_id;
  end loop;
  return v_booking;
end;
$$;

revoke all on function public.create_multi_item_booking(
  jsonb, timestamptz, integer, text, text, text, text, text, numeric, jsonb, jsonb
) from public, anon;
grant execute on function public.create_multi_item_booking(
  jsonb, timestamptz, integer, text, text, text, text, text, numeric, jsonb, jsonb
) to authenticated;
