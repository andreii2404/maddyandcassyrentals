-- Manual GCash migration: one booking may contain several cart products.
-- The existing booking_items/unit_reservations model already supports this;
-- this RPC adds an atomic, customer-callable creation path for it.

create or replace function private.set_booking_fulfillment_service_fee()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_local_time time;
  v_closing_at timestamptz;
  v_all_available boolean := true;
  v_item record;
  v_available integer;
begin
  select * into v_booking from public.bookings where id = new.booking_id;
  if v_booking.id is null then return new; end if;

  v_local_time := (v_booking.pickup_at at time zone 'Asia/Manila')::time;
  new.pickup_convenience_fee_snapshot := 0;
  if v_local_time < time '09:00' then
    new.pickup_convenience_fee_snapshot := 100;
    return new;
  end if;
  if v_local_time <= time '19:00' then return new; end if;

  v_closing_at := (
    (v_booking.pickup_at at time zone 'Asia/Manila')::date + time '19:00'
  ) at time zone 'Asia/Manila';

  for v_item in
    select bi.id, bi.product_id, bi.quantity
    from public.booking_items bi
    where bi.booking_id = new.booking_id
  loop
    select count(*)::integer into v_available
    from public.inventory_units iu
    where iu.product_id = v_item.product_id
      and iu.lifecycle_status = 'active'
      and not exists (
        select 1 from public.unit_reservations ur
        join public.booking_items occupied_item on occupied_item.id = ur.booking_item_id
        where ur.inventory_unit_id = iu.id
          and occupied_item.booking_id <> new.booking_id
          and ur.status in ('tentative', 'confirmed', 'in_use')
          and ur.reserved_window && tstzrange(
            v_closing_at,
            v_closing_at + make_interval(days => upper(v_booking.rental_period) - lower(v_booking.rental_period)),
            '[)'
          )
      );
    if v_available < v_item.quantity then
      v_all_available := false;
      exit;
    end if;
  end loop;

  -- Charge only when the customer voluntarily selected a post-7 PM time.
  -- If any selected item forced the later time, the fee remains zero.
  if v_all_available then new.pickup_convenience_fee_snapshot := 100; end if;
  return new;
end;
$$;

revoke all on function private.set_booking_fulfillment_service_fee()
  from public, anon, authenticated;

create trigger set_booking_fulfillment_service_fee
before insert or update of pickup_convenience_fee_snapshot, booking_id
on public.booking_fulfillments
for each row execute function private.set_booking_fulfillment_service_fee();

create or replace function public.create_multi_item_time_based_booking(
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
  v_first jsonb;
  v_line jsonb;
  v_booking public.bookings;
  v_product record;
  v_item_id uuid;
  v_unit_ids uuid[];
  v_quantity integer;
  v_discount_percent numeric;
  v_discount_text text;
  v_daily_rate numeric(12,2);
  v_window tstzrange;
  v_total_subtotal numeric(12,2);
  v_birthday numeric(12,2) := 0;
  v_loyalty numeric(12,2) := 0;
  v_birth_date date;
  v_days integer := coalesce(p_rental_days, 1);
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 10 then
    raise exception 'INVALID_BOOKING_ITEMS';
  end if;
  v_first := p_items -> 0;

  v_booking := public.create_multi_day_time_based_booking(
    (v_first ->> 'productId')::uuid,
    p_pickup_at,
    p_fulfillment_method,
    p_location,
    p_customer_notes,
    p_delivery_fee,
    0,
    coalesce(v_first -> 'productSnapshot', '{}'::jsonb),
    p_customer_snapshot,
    p_emergency_contact,
    p_city_municipality,
    p_province,
    greatest(coalesce((v_first ->> 'quantity')::integer, 1), 1),
    v_days
  );

  v_window := tstzrange(v_booking.pickup_at, v_booking.next_available_at, '[)');

  for v_line in select value from jsonb_array_elements(p_items) with ordinality e(value, ord) where ord > 1
  loop
    v_quantity := coalesce((v_line ->> 'quantity')::integer, 1);
    if v_quantity < 1 or v_quantity > 10 then raise exception 'INVALID_QUANTITY'; end if;

    select id, daily_rate, refundable_deposit, specifications, status
      into v_product
      from public.products
      where id = (v_line ->> 'productId')::uuid
      for share;
    if v_product.id is null or v_product.status <> 'active' then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;

    v_discount_percent := 0;
    v_discount_text := nullif(v_product.specifications ->> 'discountPercent', '');
    if v_discount_text is not null and v_discount_text ~ '^([0-9]+)(\.[0-9]+)?$' then
      v_discount_percent := least(greatest(v_discount_text::numeric, 0), 90);
    end if;
    v_daily_rate := round(v_product.daily_rate * (1 - v_discount_percent / 100), 2);

    select coalesce(array_agg(candidate.id), '{}'::uuid[]) into v_unit_ids
    from (
      select iu.id
      from public.inventory_units iu
      where iu.product_id = v_product.id
        and iu.lifecycle_status = 'active'
        and not exists (
          select 1 from public.unit_reservations ur
          where ur.inventory_unit_id = iu.id
            and ur.status in ('tentative', 'confirmed', 'in_use')
            and ur.reserved_window && v_window
        )
      order by iu.id
      for update of iu skip locked
      limit v_quantity
    ) candidate;

    if cardinality(v_unit_ids) < v_quantity then
      raise exception 'NO_TIME_AVAILABILITY:%',
        private.next_product_multi_day_pickup_at(v_product.id, p_pickup_at, v_quantity, v_days)
        using errcode = 'P0001';
    end if;

    insert into public.booking_items (
      booking_id, product_id, product_name_snapshot, daily_rate_snapshot,
      deposit_per_unit_snapshot, quantity
    ) values (
      v_booking.id, v_product.id,
      coalesce(nullif(v_line #>> '{productSnapshot,name}', ''), 'Rental item'),
      v_daily_rate, v_product.refundable_deposit, v_quantity
    ) returning id into v_item_id;

    insert into public.unit_reservations (
      inventory_unit_id, booking_item_id, kind, status,
      reserved_period, reserved_window, created_by
    )
    select unit_id, v_item_id, 'booking', 'tentative',
           v_booking.rental_period, v_window, auth.uid()
    from unnest(v_unit_ids) unit_id;
  end loop;

  select coalesce(sum(bi.daily_rate_snapshot * bi.quantity * v_days), 0)
    into v_total_subtotal
    from public.booking_items bi where bi.booking_id = v_booking.id;
  select pr.birth_date into v_birth_date from public.profiles pr where pr.id = auth.uid();

  if v_birth_date is not null
    and extract(month from (p_pickup_at at time zone 'Asia/Manila')::date) = extract(month from v_birth_date)
  then v_birthday := least(100, v_total_subtotal); end if;
  if v_booking.loyalty_completed_rentals_snapshot >= 10 and v_booking.loyalty_discount_status = 'applied'
  then v_loyalty := least(200, greatest(v_total_subtotal - v_birthday, 0)); end if;

  update public.bookings
  set birthday_discount_amount = v_birthday,
      birthday_discount_status = case when v_birthday > 0 then birthday_discount_status else 'not_eligible' end,
      loyalty_discount_amount = v_loyalty,
      loyalty_discount_status = case when v_loyalty > 0 then 'applied' else 'not_eligible' end
  where id = v_booking.id
  returning * into v_booking;

  -- Re-run the fee trigger now that every cart item exists.
  update public.booking_fulfillments
  set pickup_convenience_fee_snapshot = pickup_convenience_fee_snapshot
  where booking_id = v_booking.id;

  perform private.log_audit_event(
    'booking.multi_item_created', 'booking', v_booking.id::text, v_booking.id,
    null, to_jsonb(v_booking),
    jsonb_build_object('itemCount', jsonb_array_length(p_items), 'items', p_items), 'user'
  );
  return v_booking;
exception
  when exclusion_violation then
    raise exception 'NO_TIME_AVAILABILITY' using errcode = 'P0001';
end;
$$;

revoke all on function public.create_multi_item_time_based_booking(
  jsonb, timestamptz, integer, text, text, text, text, text, numeric, jsonb, jsonb
) from public, anon;
grant execute on function public.create_multi_item_time_based_booking(
  jsonb, timestamptz, integer, text, text, text, text, text, numeric, jsonb, jsonb
) to authenticated;

comment on function public.create_multi_item_time_based_booking(
  jsonb, timestamptz, integer, text, text, text, text, text, numeric, jsonb, jsonb
) is 'Atomically creates one booking containing multiple cart products and reserves every required physical unit for the same exact pickup/return window.';
