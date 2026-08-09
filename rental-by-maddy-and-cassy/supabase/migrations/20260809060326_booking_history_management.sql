begin;

-- Customer self-service editing is intentionally narrow. A renter may update
-- pickup/delivery details and notes only while the request is still pending
-- and before payment, document review, or agreement signing has begun.
create or replace function public.update_own_booking_details(
  p_booking_id uuid,
  p_fulfillment_method text,
  p_location text default null,
  p_city_municipality text default null,
  p_province text default null,
  p_customer_notes text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_booking public.bookings;
  v_previous jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if v_booking.id is null or v_booking.customer_id <> v_uid then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  if v_booking.status <> 'pending' then
    raise exception 'BOOKING_NOT_EDITABLE';
  end if;

  if exists (
    select 1
    from public.booking_payment_submissions bps
    where bps.booking_id = p_booking_id
      and bps.status in ('submitted', 'under_review', 'verified')
  ) or exists (
    select 1
    from public.booking_requirements br
    join public.booking_requirement_submissions brs
      on brs.booking_requirement_id = br.id
    where br.booking_id = p_booking_id
  ) or exists (
    select 1 from public.booking_agreements ba where ba.booking_id = p_booking_id
  ) then
    raise exception 'BOOKING_EDIT_LOCKED';
  end if;

  if p_fulfillment_method not in ('pickup', 'delivery') then
    raise exception 'INVALID_FULFILLMENT_METHOD';
  end if;

  if p_fulfillment_method = 'delivery' and (
    nullif(trim(coalesce(p_location, '')), '') is null
    or nullif(trim(coalesce(p_city_municipality, '')), '') is null
    or nullif(trim(coalesce(p_province, '')), '') is null
  ) then
    raise exception 'INCOMPLETE_DELIVERY_ADDRESS';
  end if;

  select jsonb_build_object(
    'customer_notes', b.customer_notes,
    'fulfillment', to_jsonb(bf)
  ) into v_previous
  from public.bookings b
  left join public.booking_fulfillments bf on bf.booking_id = b.id
  where b.id = p_booking_id;

  update public.bookings
  set customer_notes = nullif(trim(coalesce(p_customer_notes, '')), '')
  where id = p_booking_id
  returning * into v_booking;

  update public.booking_fulfillments
  set method = p_fulfillment_method::public.fulfillment_method,
      address_line_1 = case
        when p_fulfillment_method = 'delivery' then nullif(trim(p_location), '')
        else null
      end,
      city_municipality = case
        when p_fulfillment_method = 'delivery' then nullif(trim(p_city_municipality), '')
        else null
      end,
      province = case
        when p_fulfillment_method = 'delivery' then nullif(trim(p_province), '')
        else null
      end,
      delivery_fee_snapshot = case
        when p_fulfillment_method = 'delivery' then delivery_fee_snapshot
        else 0
      end
  where booking_id = p_booking_id;

  perform private.log_audit_event(
    'booking.details_updated',
    'booking',
    v_booking.id::text,
    v_booking.id,
    v_previous,
    jsonb_build_object(
      'customer_notes', v_booking.customer_notes,
      'fulfillment_method', p_fulfillment_method,
      'location', case when p_fulfillment_method = 'delivery' then trim(p_location) else null end,
      'city_municipality', case when p_fulfillment_method = 'delivery' then trim(p_city_municipality) else null end,
      'province', case when p_fulfillment_method = 'delivery' then trim(p_province) else null end
    ),
    '{}'::jsonb,
    'user'
  );

  return v_booking;
end;
$$;

revoke all on function public.update_own_booking_details(uuid, text, text, text, text, text) from public;
grant execute on function public.update_own_booking_details(uuid, text, text, text, text, text) to authenticated;

comment on function public.update_own_booking_details is
  'Allows the authenticated owner to edit only unpaid, pending booking fulfillment details and customer notes.';

-- Repair the customer cancellation history entry so it records the real
-- previous state (pending or approved), then release its reserved unit.
create or replace function public.cancel_own_booking(
  p_booking_id uuid,
  p_note text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_booking public.bookings;
  v_previous_status public.booking_status;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.id is null or v_booking.customer_id <> v_uid then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  if v_booking.status not in ('pending', 'approved') then
    raise exception 'BOOKING_NOT_CANCELLABLE';
  end if;

  v_previous_status := v_booking.status;

  update public.bookings
  set status = 'cancelled', cancelled_at = now()
  where id = p_booking_id
  returning * into v_booking;

  insert into public.booking_status_history (booking_id, from_status, to_status, note, changed_by)
  values (
    p_booking_id,
    v_previous_status,
    'cancelled',
    coalesce(nullif(trim(p_note), ''), 'Cancelled by renter.'),
    v_uid
  );

  update public.unit_reservations ur
  set status = 'cancelled'
  where ur.booking_item_id in (
    select bi.id from public.booking_items bi where bi.booking_id = p_booking_id
  ) and ur.status in ('tentative', 'confirmed');

  insert into public.notifications (user_id, notification_type, title, message, booking_id)
  values (
    v_booking.customer_id,
    'booking_cancelled',
    'Booking ' || v_booking.booking_reference || ' cancelled',
    'Your booking was cancelled and its reserved dates were released.',
    v_booking.id
  );

  perform private.log_audit_event(
    'booking.cancelled', 'booking', v_booking.id::text, v_booking.id,
    jsonb_build_object('status', v_previous_status),
    jsonb_build_object('status', 'cancelled'),
    jsonb_build_object('note', p_note), 'user'
  );

  return v_booking;
end;
$$;

revoke all on function public.cancel_own_booking(uuid, text) from public;
grant execute on function public.cancel_own_booking(uuid, text) to authenticated;

-- Add an explicit ready-for-handover milestone and repair from_status logging.
-- Confirmation remains gated through confirm_booking(); this RPC cannot bypass
-- verified payment, approved documents, or the completed agreement.
create or replace function public.admin_set_booking_status(
  p_booking_id uuid,
  p_new_status text,
  p_note text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_booking public.bookings;
  v_previous_status public.booking_status;
  v_allowed boolean;
  v_method public.fulfillment_method;
  v_customer_message text;
begin
  v_uid := auth.uid();
  if v_uid is null or not (select private.is_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  v_previous_status := v_booking.status;
  v_allowed := case v_previous_status
    when 'pending' then p_new_status in ('approved', 'cancelled')
    when 'approved' then p_new_status in ('cancelled')
    when 'confirmed' then p_new_status in ('ready_for_release', 'cancelled')
    when 'ready_for_release' then p_new_status in ('released', 'cancelled')
    when 'released' then p_new_status in ('returned')
    else false
  end;

  if not v_allowed then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  update public.bookings
  set status = p_new_status::public.booking_status,
      approved_at = case when p_new_status = 'approved' then now() else approved_at end,
      ready_for_release_at = case when p_new_status = 'ready_for_release' then now() else ready_for_release_at end,
      released_at = case when p_new_status = 'released' then now() else released_at end,
      returned_at = case when p_new_status = 'returned' then now() else returned_at end,
      cancelled_at = case when p_new_status = 'cancelled' then now() else cancelled_at end
  where id = p_booking_id
  returning * into v_booking;

  insert into public.booking_status_history (booking_id, from_status, to_status, note, changed_by)
  values (p_booking_id, v_previous_status, p_new_status::public.booking_status, nullif(trim(p_note), ''), v_uid);

  if p_new_status in ('returned', 'cancelled') then
    update public.unit_reservations ur
    set status = case when p_new_status = 'returned' then 'completed' else 'cancelled' end
    where ur.booking_item_id in (
      select bi.id from public.booking_items bi where bi.booking_id = v_booking.id
    ) and ur.status in ('tentative', 'confirmed', 'in_use');
  elsif p_new_status = 'released' then
    update public.unit_reservations ur
    set status = 'in_use'
    where ur.booking_item_id in (
      select bi.id from public.booking_items bi where bi.booking_id = v_booking.id
    ) and ur.status = 'confirmed';
  end if;

  select method into v_method
  from public.booking_fulfillments
  where booking_id = p_booking_id;

  v_customer_message := case p_new_status
    when 'approved' then 'Your booking request was approved. Complete any remaining payment, verification, or agreement steps.'
    when 'ready_for_release' then case
      when v_method = 'delivery' then 'Your rental is prepared and ready for delivery coordination.'
      else 'Your rental is prepared and ready for pickup.'
    end
    when 'released' then case
      when v_method = 'delivery' then 'Your rental was handed over for delivery or received by you.'
      else 'Your rental was released to you at pickup.'
    end
    when 'returned' then 'Your rental was returned and this booking is now complete.'
    when 'cancelled' then 'This booking was cancelled. Contact the business if you need assistance.'
    else 'Your booking status was updated.'
  end;

  insert into public.notifications (user_id, notification_type, title, message, booking_id)
  values (
    v_booking.customer_id,
    'booking_status_changed',
    'Booking ' || v_booking.booking_reference || ' updated',
    v_customer_message,
    v_booking.id
  );

  perform private.log_audit_event(
    'booking.status_changed', 'booking', v_booking.id::text, v_booking.id,
    jsonb_build_object('status', v_previous_status),
    jsonb_build_object('status', p_new_status),
    jsonb_build_object('note', p_note), 'admin'
  );

  return v_booking;
end;
$$;

revoke all on function public.admin_set_booking_status(uuid, text, text) from public;
grant execute on function public.admin_set_booking_status(uuid, text, text) to authenticated;

commit;
