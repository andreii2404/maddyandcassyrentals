-- Allow a single rental booking to reserve more than one physical unit of the
-- same product. The function remains the authoritative availability guard:
-- it locks every selected unit in one transaction before creating the booking.

drop function if exists public.create_booking(
  uuid, date, date, text, text, text, numeric, numeric, jsonb, jsonb, jsonb, text, text
);

create function public.create_booking(
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
  v_subtotal numeric(12,2);
  v_delivery_fee numeric(12,2);
  v_discount numeric(12,2);
  v_effective_daily_rate numeric(12,2);
  v_booking public.bookings;
  v_address_line_1 text;
  v_city_municipality text;
  v_province text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if exists (
    select 1 from public.profiles pr
    where pr.id = v_uid and pr.account_status = 'suspended'
  ) then
    raise exception 'ACCOUNT_SUSPENDED' using errcode = '42501';
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

  select id, daily_rate, refundable_deposit, status
    into v_product
    from public.products
    where id = p_product_id
    for share;

  if v_product.id is null or v_product.status <> 'active' then
    raise exception 'PRODUCT_NOT_AVAILABLE';
  end if;

  v_period := daterange(p_rental_start_date, p_rental_end_date + 1, '[)');
  v_rental_days := (p_rental_end_date - p_rental_start_date) + 1;
  v_subtotal := v_product.daily_rate * v_rental_days * v_quantity;
  v_delivery_fee := case when p_fulfillment_method = 'delivery'
    then greatest(coalesce(p_delivery_fee, 0), 0)
    else 0
  end;
  v_discount := least(greatest(coalesce(p_discount_amount, 0), 0), v_subtotal);
  v_effective_daily_rate := greatest(
    v_product.daily_rate - (v_discount / (v_rental_days * v_quantity)),
    0
  );

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

  insert into public.bookings (customer_id, status, rental_period, currency_code, customer_notes)
  values (v_uid, 'pending', v_period, 'PHP', nullif(p_customer_notes, ''))
  returning * into v_booking;

  insert into public.booking_items (
    booking_id, product_id, product_name_snapshot, daily_rate_snapshot,
    deposit_per_unit_snapshot, quantity
  )
  values (
    v_booking.id, p_product_id,
    coalesce(nullif(p_product_snapshot ->> 'name', ''), 'Rental item'),
    v_effective_daily_rate, v_product.refundable_deposit, v_quantity
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
    format('Booking created by renter for %s unit(s).', v_quantity),
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
  select
    unit_id, v_item_id, 'booking', 'tentative', v_period, v_uid
  from unnest(v_unit_ids) as unit_id;

  perform private.log_audit_event(
    'booking.created', 'booking', v_booking.id::text, v_booking.id,
    null, to_jsonb(v_booking), jsonb_build_object('quantity', v_quantity), 'user'
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
) is 'Creates one product booking and atomically reserves the requested number of physical units.';
