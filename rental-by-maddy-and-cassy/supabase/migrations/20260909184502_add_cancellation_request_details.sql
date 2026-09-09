begin;

alter table public.booking_cancellation_requests
  add column if not exists additional_details text;

alter table public.booking_cancellation_requests
  drop constraint if exists booking_cancellation_requests_additional_details_check;

alter table public.booking_cancellation_requests
  add constraint booking_cancellation_requests_additional_details_check
  check (additional_details is null or char_length(btrim(additional_details)) <= 1000);

comment on column public.booking_cancellation_requests.additional_details is
  'Optional customer explanation beyond the selected cancellation reason.';

-- Replace the two-argument function so all new requests use the structured
-- reason field and optional details. The old direct-cancellation function is
-- intentionally not used; booking status and reservations remain unchanged.
drop function if exists public.request_booking_cancellation(uuid, text);

create function public.request_booking_cancellation(
  p_booking_id uuid,
  p_reason text,
  p_additional_details text default null
)
returns public.booking_cancellation_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.bookings;
  v_request public.booking_cancellation_requests;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_additional_details text := nullif(btrim(coalesce(p_additional_details, '')), '');
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if v_reason not in (
    'Change of plans',
    'Wrong booking details',
    'Schedule conflict',
    'Budget issue',
    'Found another option',
    'Other'
  ) then
    raise exception 'INVALID_CANCELLATION_REASON';
  end if;

  if char_length(coalesce(p_additional_details, '')) > 1000 then
    raise exception 'ADDITIONAL_DETAILS_TOO_LONG';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
    and customer_id = v_uid
  for update;

  if v_booking.id is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  if v_booking.status not in ('pending', 'approved') then
    raise exception 'BOOKING_NOT_CANCELLABLE';
  end if;

  if exists (
    select 1
    from public.booking_cancellation_requests
    where booking_id = p_booking_id and status = 'pending'
  ) then
    raise exception 'CANCELLATION_REQUEST_EXISTS';
  end if;

  insert into public.booking_cancellation_requests (
    booking_id, customer_id, requested_status, reason, additional_details
  ) values (
    v_booking.id, v_uid, v_booking.status, v_reason, v_additional_details
  ) returning * into v_request;

  insert into public.admin_notifications (
    admin_user_id, booking_id, notification_type, title, message, action_url
  )
  select
    ur.user_id,
    v_booking.id,
    'booking_cancellation_requested',
    'Cancellation requested for ' || v_booking.booking_reference,
    'The customer requested cancellation: ' || v_reason,
    '/admin/bookings/' || v_booking.id::text
  from public.user_roles ur
  where ur.role = 'admin';

  perform private.log_audit_event(
    'booking.cancellation_requested', 'booking', v_booking.id::text, v_booking.id,
    jsonb_build_object('status', v_booking.status),
    jsonb_build_object(
      'cancellation_request_id', v_request.id,
      'reason', v_reason,
      'additional_details', v_additional_details
    ),
    '{}'::jsonb, 'user'
  );

  return v_request;
exception
  when unique_violation then
    raise exception 'CANCELLATION_REQUEST_EXISTS';
end;
$$;

revoke all on function public.request_booking_cancellation(uuid, text, text) from public, anon;
grant execute on function public.request_booking_cancellation(uuid, text, text) to authenticated;

commit;
