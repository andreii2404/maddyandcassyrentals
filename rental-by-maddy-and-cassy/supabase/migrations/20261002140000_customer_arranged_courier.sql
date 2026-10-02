-- Customer-arranged courier for delivery bookings.
--
-- Delivery customers now choose the courier they book themselves (Lalamove,
-- Grab, Angkas, or another named courier) and how they will return the rental
-- (by their own courier, or in person). The customer pays the courier
-- directly, so the courier-aware RPCs below always store a zero delivery fee:
-- courier costs never reach booking_totals or the online payment.
--
-- The existing booking RPCs are left untouched (pickup bookings keep using
-- them); the new wrappers call them and then save the courier in the same
-- transaction, so an invalid courier rolls the whole booking back.
-- The client rules live in src/lib/courierArrangement.ts -- keep them in sync.

begin;

alter table public.booking_fulfillments
  add column if not exists delivery_courier text,
  add column if not exists delivery_courier_other text,
  add column if not exists return_method text,
  add column if not exists return_courier text,
  add column if not exists return_courier_other text;

alter table public.booking_fulfillments
  drop constraint if exists booking_fulfillments_delivery_courier_chk,
  drop constraint if exists booking_fulfillments_return_method_chk,
  drop constraint if exists booking_fulfillments_return_courier_chk;

alter table public.booking_fulfillments
  add constraint booking_fulfillments_delivery_courier_chk check (
    (delivery_courier is null and delivery_courier_other is null)
    or (delivery_courier in ('lalamove', 'grab', 'angkas') and delivery_courier_other is null)
    or (
      delivery_courier = 'other'
      and char_length(trim(coalesce(delivery_courier_other, ''))) between 1 and 60
    )
  ),
  add constraint booking_fulfillments_return_method_chk check (
    return_method is null or return_method in ('courier', 'dropoff')
  ),
  add constraint booking_fulfillments_return_courier_chk check (
    (return_courier is null and return_courier_other is null)
    or (
      return_method = 'courier'
      and (
        (return_courier in ('lalamove', 'grab', 'angkas') and return_courier_other is null)
        or (
          return_courier = 'other'
          and char_length(trim(coalesce(return_courier_other, ''))) between 1 and 60
        )
      )
    )
  );

comment on column public.booking_fulfillments.delivery_courier is
  'Courier the customer books and pays for delivery: lalamove, grab, angkas, or other. Never billed through the website.';
comment on column public.booking_fulfillments.delivery_courier_other is
  'Courier name when delivery_courier = other.';
comment on column public.booking_fulfillments.return_method is
  'How a delivery customer returns the rental: courier (customer-booked and paid) or dropoff (in person).';
comment on column public.booking_fulfillments.return_courier is
  'Courier the customer books and pays for the return when return_method = courier.';
comment on column public.booking_fulfillments.return_courier_other is
  'Courier name when return_courier = other.';

-- Validates and stores the courier arrangement for one booking. Pickup
-- bookings never keep a courier. Callers must already have authorized the
-- booking (the public wrappers below run the existing ownership checks first).
create or replace function private.apply_customer_courier(
  p_booking_id uuid,
  p_fulfillment_method text,
  p_courier jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_delivery_courier text := lower(nullif(trim(coalesce(p_courier ->> 'deliveryCourier', '')), ''));
  v_delivery_other text := nullif(trim(coalesce(p_courier ->> 'deliveryCourierOther', '')), '');
  v_return_method text := lower(nullif(trim(coalesce(p_courier ->> 'returnMethod', '')), ''));
  v_return_courier text := lower(nullif(trim(coalesce(p_courier ->> 'returnCourier', '')), ''));
  v_return_other text := nullif(trim(coalesce(p_courier ->> 'returnCourierOther', '')), '');
begin
  if p_fulfillment_method is distinct from 'delivery' then
    v_delivery_courier := null;
    v_delivery_other := null;
    v_return_method := null;
    v_return_courier := null;
    v_return_other := null;
  else
    if v_delivery_courier is null
       or v_delivery_courier not in ('lalamove', 'grab', 'angkas', 'other') then
      raise exception 'DELIVERY_COURIER_REQUIRED';
    end if;

    if v_delivery_courier = 'other' then
      if v_delivery_other is null then
        raise exception 'DELIVERY_COURIER_REQUIRED';
      end if;
      if char_length(v_delivery_other) > 60 then
        raise exception 'COURIER_NAME_TOO_LONG';
      end if;
    else
      v_delivery_other := null;
    end if;

    if v_return_method is null or v_return_method not in ('courier', 'dropoff') then
      raise exception 'RETURN_ARRANGEMENT_REQUIRED';
    end if;

    if v_return_method = 'courier' then
      if v_return_courier is null
         or v_return_courier not in ('lalamove', 'grab', 'angkas', 'other') then
        raise exception 'RETURN_COURIER_REQUIRED';
      end if;

      if v_return_courier = 'other' then
        if v_return_other is null then
          raise exception 'RETURN_COURIER_REQUIRED';
        end if;
        if char_length(v_return_other) > 60 then
          raise exception 'COURIER_NAME_TOO_LONG';
        end if;
      else
        v_return_other := null;
      end if;
    else
      v_return_courier := null;
      v_return_other := null;
    end if;
  end if;

  update public.booking_fulfillments
  set delivery_courier = v_delivery_courier,
      delivery_courier_other = v_delivery_other,
      return_method = v_return_method,
      return_courier = v_return_courier,
      return_courier_other = v_return_other
  where booking_id = p_booking_id;

  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
end;
$$;

revoke all on function private.apply_customer_courier(uuid, text, jsonb)
  from public, anon, authenticated;

-- Single-item checkout. Same arguments as create_multi_day_time_based_booking
-- minus p_delivery_fee (always 0: the customer pays the courier directly)
-- plus p_courier.
create or replace function public.create_booking_with_courier(
  p_product_id uuid,
  p_pickup_at timestamptz,
  p_fulfillment_method text,
  p_location text,
  p_customer_notes text,
  p_discount_amount numeric,
  p_product_snapshot jsonb,
  p_customer_snapshot jsonb,
  p_courier jsonb,
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
begin
  v_booking := public.create_multi_day_time_based_booking(
    p_product_id => p_product_id,
    p_pickup_at => p_pickup_at,
    p_fulfillment_method => p_fulfillment_method,
    p_location => p_location,
    p_customer_notes => p_customer_notes,
    p_delivery_fee => 0::numeric,
    p_discount_amount => p_discount_amount,
    p_product_snapshot => p_product_snapshot,
    p_customer_snapshot => p_customer_snapshot,
    p_emergency_contact => p_emergency_contact,
    p_city_municipality => p_city_municipality,
    p_province => p_province,
    p_quantity => p_quantity,
    p_rental_days => p_rental_days,
    p_variant => p_variant
  );

  perform private.apply_customer_courier(v_booking.id, p_fulfillment_method, p_courier);
  return v_booking;
end;
$$;

revoke all on function public.create_booking_with_courier(
  uuid, timestamptz, text, text, text, numeric, jsonb, jsonb, jsonb, jsonb,
  text, text, integer, integer, text
) from public, anon;
grant execute on function public.create_booking_with_courier(
  uuid, timestamptz, text, text, text, numeric, jsonb, jsonb, jsonb, jsonb,
  text, text, integer, integer, text
) to authenticated;

-- Cart checkout. Same arguments as create_multi_item_booking minus
-- p_delivery_fee (always 0) plus p_courier.
create or replace function public.create_multi_item_booking_with_courier(
  p_items jsonb,
  p_pickup_at timestamptz,
  p_rental_days integer,
  p_fulfillment_method text,
  p_location text,
  p_city_municipality text,
  p_province text,
  p_customer_notes text,
  p_customer_snapshot jsonb,
  p_courier jsonb,
  p_emergency_contact jsonb default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
begin
  v_booking := public.create_multi_item_booking(
    p_items => p_items,
    p_pickup_at => p_pickup_at,
    p_rental_days => p_rental_days,
    p_fulfillment_method => p_fulfillment_method,
    p_location => p_location,
    p_city_municipality => p_city_municipality,
    p_province => p_province,
    p_customer_notes => p_customer_notes,
    p_delivery_fee => 0::numeric,
    p_customer_snapshot => p_customer_snapshot,
    p_emergency_contact => p_emergency_contact
  );

  perform private.apply_customer_courier(v_booking.id, p_fulfillment_method, p_courier);
  return v_booking;
end;
$$;

revoke all on function public.create_multi_item_booking_with_courier(
  jsonb, timestamptz, integer, text, text, text, text, text, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.create_multi_item_booking_with_courier(
  jsonb, timestamptz, integer, text, text, text, text, text, jsonb, jsonb, jsonb
) to authenticated;

-- Customer self-service edit. update_own_booking_details() keeps doing the
-- ownership, pending-status, and edit-lock checks; the courier is saved (or
-- cleared for pickup) afterwards in the same transaction.
create or replace function public.update_own_booking_details_with_courier(
  p_booking_id uuid,
  p_fulfillment_method text,
  p_location text default null,
  p_city_municipality text default null,
  p_province text default null,
  p_customer_notes text default null,
  p_courier jsonb default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
begin
  v_booking := public.update_own_booking_details(
    p_booking_id,
    p_fulfillment_method,
    p_location,
    p_city_municipality,
    p_province,
    p_customer_notes
  );

  perform private.apply_customer_courier(p_booking_id, p_fulfillment_method, p_courier);
  return v_booking;
end;
$$;

revoke all on function public.update_own_booking_details_with_courier(
  uuid, text, text, text, text, text, jsonb
) from public, anon;
grant execute on function public.update_own_booking_details_with_courier(
  uuid, text, text, text, text, text, jsonb
) to authenticated;

commit;

notify pgrst, 'reload schema';
