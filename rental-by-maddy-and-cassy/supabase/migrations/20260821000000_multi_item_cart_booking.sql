-- Combined multi-item cart checkout: one booking, many booking_items, one
-- shared rental period. Adds two new RPCs and patches create_time_based_booking
-- so the product name persisted into booking_items is always server-derived
-- (never trusted from the client), matching the same standard the new RPC is
-- held to.

-- ---------------------------------------------------------------------------
-- 1. create_time_based_booking: derive product_name_snapshot from products.name
--    instead of the client-supplied p_product_snapshot. Signature unchanged,
--    so every existing caller (create_multi_day_time_based_booking, and any
--    client code) keeps working without modification.
-- ---------------------------------------------------------------------------

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

  select id, name, daily_rate, refundable_deposit, specifications, status
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
    coalesce(v_product.name, 'Rental item'),
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

-- ---------------------------------------------------------------------------
-- 2. create_multi_item_booking: one booking, many products/quantities, one
--    shared rental period. p_items carries {productId, quantity} only --
--    name/price/discount/deposit are always looked up from products here,
--    never trusted from the client. Delivery fee is not accepted from the
--    client either: there is no server-side delivery-pricing-rules table yet
--    and the app's own copy already states delivery fees are arranged
--    separately, off-platform -- this simply always persists 0, matching
--    today's actual behavior.
-- ---------------------------------------------------------------------------

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
  v_uid uuid;
  v_days integer := coalesce(p_rental_days, 1);
  v_items_count integer;
  v_distinct_count integer;
  v_sorted_product_ids uuid[];
  v_product_id uuid;
  v_quantity integer;
  v_product record;
  v_discount_percent numeric;
  v_discount_text text;
  v_daily_rate numeric(12,2);
  v_total_catalog_subtotal numeric(12,2) := 0;
  v_pickup_local_date date;
  v_return_at timestamptz;
  v_next_available_at timestamptz;
  v_reserved_window tstzrange;
  v_period daterange;
  v_delivery_fee numeric(12,2) := 0;
  v_birth_date date;
  v_birth_date_verified_at timestamptz;
  v_birthday_discount numeric(12,2) := 0;
  v_birthday_status text := 'not_eligible';
  v_completed_rentals integer := 0;
  v_loyalty_reward_used boolean := false;
  v_loyalty_discount numeric(12,2) := 0;
  v_loyalty_status text := 'not_eligible';
  v_booking public.bookings;
  v_item_id uuid;
  v_unit_ids uuid[];
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

  if v_days < 1 or v_days > 30 then
    raise exception 'INVALID_RENTAL_DAYS';
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

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_REQUIRED';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'TOO_MANY_ITEMS';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) elem
    where nullif(elem ->> 'productId', '') is null
       or nullif(elem ->> 'quantity', '') is null
  ) then
    raise exception 'INVALID_ITEM_PAYLOAD';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) elem
    where (elem ->> 'quantity')::integer < 1 or (elem ->> 'quantity')::integer > 10
  ) then
    raise exception 'INVALID_QUANTITY';
  end if;

  select count(*) into v_items_count from jsonb_array_elements(p_items);
  select count(distinct (elem ->> 'productId')) into v_distinct_count
    from jsonb_array_elements(p_items) elem;
  if v_distinct_count < v_items_count then
    raise exception 'DUPLICATE_PRODUCT_ITEMS';
  end if;

  -- Lock ordering: always process products in the same sorted order so two
  -- concurrent multi-item bookings that share products never deadlock.
  select coalesce(array_agg(distinct (elem ->> 'productId')::uuid order by (elem ->> 'productId')::uuid), '{}'::uuid[])
    into v_sorted_product_ids
    from jsonb_array_elements(p_items) elem;

  v_pickup_local_date := (p_pickup_at at time zone 'Asia/Manila')::date;
  v_return_at := p_pickup_at + make_interval(hours => 22 + ((v_days - 1) * 24));
  v_next_available_at := v_return_at + interval '2 hours';
  v_reserved_window := tstzrange(p_pickup_at, v_next_available_at, '[)');
  v_period := daterange(v_pickup_local_date, v_pickup_local_date + v_days, '[)');

  -- First pass: validate every product is active and accumulate the
  -- aggregate catalog subtotal (server-derived rates only) so birthday/loyalty
  -- perks can be computed once, against the whole booking.
  foreach v_product_id in array v_sorted_product_ids loop
    select (elem ->> 'quantity')::integer into v_quantity
      from jsonb_array_elements(p_items) elem
      where (elem ->> 'productId')::uuid = v_product_id;

    select id, name, daily_rate, refundable_deposit, specifications, status
      into v_product
      from public.products
      where id = v_product_id
      for share;
    if v_product.id is null or v_product.status <> 'active' then
      raise exception 'PRODUCT_NOT_AVAILABLE';
    end if;

    v_discount_percent := 0;
    v_discount_text := nullif(v_product.specifications ->> 'discountPercent', '');
    if v_discount_text is not null and v_discount_text ~ '^([0-9]+)(\.[0-9]+)?$' then
      v_discount_percent := least(greatest(v_discount_text::numeric, 0), 90);
    end if;
    v_daily_rate := round(v_product.daily_rate * (1 - (v_discount_percent / 100)), 2);

    v_total_catalog_subtotal := v_total_catalog_subtotal + (v_daily_rate * v_quantity * v_days);
  end loop;

  if v_birth_date is not null
    and extract(month from v_pickup_local_date) = extract(month from v_birth_date)
  then
    v_birthday_discount := least(100, v_total_catalog_subtotal);
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
    v_loyalty_discount := least(200, greatest(v_total_catalog_subtotal - v_birthday_discount, 0));
    if v_loyalty_discount > 0 then v_loyalty_status := 'applied'; end if;
  end if;

  -- Delivery fee: no server-side delivery-pricing-rules table exists yet, and
  -- the app's own copy already states delivery fees are arranged separately,
  -- off-platform. Never trust p_delivery_fee from the client -- always 0.
  v_delivery_fee := 0;

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

  -- Second pass, same sorted order as the first: lock and assign units per
  -- product, insert its booking_items row, and its unit_reservations rows.
  -- Any shortfall raises and rolls back the whole booking (header included).
  foreach v_product_id in array v_sorted_product_ids loop
    select (elem ->> 'quantity')::integer into v_quantity
      from jsonb_array_elements(p_items) elem
      where (elem ->> 'productId')::uuid = v_product_id;

    select id, name, daily_rate, refundable_deposit, specifications, status
      into v_product
      from public.products
      where id = v_product_id
      for share;

    v_discount_percent := 0;
    v_discount_text := nullif(v_product.specifications ->> 'discountPercent', '');
    if v_discount_text is not null and v_discount_text ~ '^([0-9]+)(\.[0-9]+)?$' then
      v_discount_percent := least(greatest(v_discount_text::numeric, 0), 90);
    end if;
    v_daily_rate := round(v_product.daily_rate * (1 - (v_discount_percent / 100)), 2);

    select coalesce(array_agg(candidate.id), '{}'::uuid[])
      into v_unit_ids
      from (
        select iu.id
        from public.inventory_units iu
        where iu.product_id = v_product_id
          and iu.lifecycle_status = 'active'
          and not exists (
            select 1
            from public.unit_reservations ur
            where ur.inventory_unit_id = iu.id
              and ur.status in ('tentative', 'confirmed', 'in_use')
              and ur.reserved_window && v_reserved_window
          )
        order by iu.id
        for update of iu skip locked
        limit v_quantity
      ) candidate;

    if cardinality(v_unit_ids) < v_quantity then
      raise exception 'NO_TIME_AVAILABILITY:%:%',
        v_product_id,
        private.next_product_multi_day_pickup_at(v_product_id, p_pickup_at, v_quantity, v_days)
        using errcode = 'P0001';
    end if;

    insert into public.booking_items (
      booking_id, product_id, product_name_snapshot, daily_rate_snapshot,
      deposit_per_unit_snapshot, quantity
    ) values (
      v_booking.id, v_product_id,
      coalesce(v_product.name, 'Rental item'),
      v_daily_rate, v_product.refundable_deposit, v_quantity
    ) returning id into v_item_id;

    insert into public.unit_reservations (
      inventory_unit_id, booking_item_id, kind, status,
      reserved_period, reserved_window, created_by
    )
    select unit_id, v_item_id, 'booking', 'tentative',
           v_period, v_reserved_window, v_uid
    from unnest(v_unit_ids) as unit_id;
  end loop;

  insert into public.booking_fulfillments (
    booking_id, method, address_line_1, city_municipality, province,
    delivery_fee_snapshot, pickup_convenience_fee_snapshot,
    recipient_name, contact_number
  ) values (
    v_booking.id, p_fulfillment_method::public.fulfillment_method,
    v_address_line_1, v_city_municipality, v_province,
    v_delivery_fee, 0,
    nullif(p_customer_snapshot ->> 'fullName', ''),
    nullif(p_customer_snapshot ->> 'phone', '')
  );

  insert into public.booking_status_history (booking_id, from_status, to_status, note, changed_by)
  values (
    v_booking.id, null, 'pending',
    format('Booking created for %s item(s), pickup %s, return %s.',
      cardinality(v_sorted_product_ids), p_pickup_at, v_return_at),
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

  perform private.log_audit_event(
    'booking.multi_item_created', 'booking', v_booking.id::text, v_booking.id,
    null, to_jsonb(v_booking),
    jsonb_build_object(
      'itemCount', cardinality(v_sorted_product_ids),
      'pickupAt', p_pickup_at,
      'returnAt', v_return_at,
      'nextAvailableAt', v_next_available_at
    ),
    'user'
  );

  return v_booking;
exception
  when exclusion_violation then
    raise exception 'NO_TIME_AVAILABILITY:%:%',
      coalesce(v_product_id::text, ''),
      private.next_product_multi_day_pickup_at(v_product_id, p_pickup_at, v_quantity, v_days)
      using errcode = 'P0001';
end;
$$;

revoke all on function public.create_multi_item_booking(
  jsonb, timestamptz, integer, text, text, text, text, text, numeric, jsonb, jsonb
) from public, anon;
grant execute on function public.create_multi_item_booking(
  jsonb, timestamptz, integer, text, text, text, text, text, numeric, jsonb, jsonb
) to authenticated;

comment on function public.create_multi_item_booking(
  jsonb, timestamptz, integer, text, text, text, text, text, numeric, jsonb, jsonb
) is 'Creates one booking spanning multiple products/quantities over one shared rental period, reserving each physical unit individually. p_items carries {productId, quantity} only -- name/price/discount/deposit are always server-derived.';

-- ---------------------------------------------------------------------------
-- 3. get_booking_unit_assignments: the only way unit codes/serial numbers
--    ever reach the client or the server-side PDF generator. No status
--    filter -- a completed/cancelled reservation is still this booking's own
--    history. Callers that need "is this fully allocated right now" must
--    filter reservation_status themselves (tentative/confirmed/in_use).
-- ---------------------------------------------------------------------------

create or replace function public.get_booking_unit_assignments(p_booking_id uuid)
returns table (
  booking_item_id uuid,
  product_id uuid,
  inventory_unit_id uuid,
  unit_code text,
  serial_number text,
  reservation_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_authorized boolean;
begin
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id
      and (b.customer_id = v_uid or (select private.is_admin()))
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
    select bi.id, bi.product_id, ur.inventory_unit_id, iu.unit_code, iu.serial_number, ur.status::text
    from public.booking_items bi
    join public.unit_reservations ur on ur.booking_item_id = bi.id
    join public.inventory_units iu on iu.id = ur.inventory_unit_id
    where bi.booking_id = p_booking_id
    order by bi.id, iu.unit_code;
end;
$$;

revoke all on function public.get_booking_unit_assignments(uuid) from public, anon;
grant execute on function public.get_booking_unit_assignments(uuid) to authenticated;

comment on function public.get_booking_unit_assignments(uuid) is
  'Returns every unit_reservations row (active and historical, no status filter) for a booking''s items, joined to inventory_units for unit_code/serial_number. Caller must be the booking''s customer or an admin. Callers deciding "is allocation complete" must filter reservation_status to tentative/confirmed/in_use themselves.';
