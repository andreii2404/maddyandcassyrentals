-- Keep admin booking transitions atomic while assigning the enum-typed
-- reservation status explicitly. PostgreSQL resolves a CASE made from text
-- parameters/literals as text, which cannot be assigned implicitly to the
-- unit_reservation_status enum.
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
    set status = (
      case when p_new_status = 'returned' then 'completed' else 'cancelled' end
    )::public.unit_reservation_status
    where ur.booking_item_id in (
      select bi.id from public.booking_items bi where bi.booking_id = v_booking.id
    ) and ur.status in ('tentative', 'confirmed', 'in_use');
  elsif p_new_status = 'released' then
    update public.unit_reservations ur
    set status = 'in_use'::public.unit_reservation_status
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
revoke all on function public.admin_set_booking_status(uuid, text, text) from anon;
grant execute on function public.admin_set_booking_status(uuid, text, text) to authenticated;
