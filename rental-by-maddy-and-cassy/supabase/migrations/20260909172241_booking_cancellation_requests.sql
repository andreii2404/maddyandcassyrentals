begin;

-- A cancellation request is intentionally separate from bookings.status. The
-- booking keeps its current lifecycle state until an administrator decides,
-- so availability and customer-facing status cannot change before review.
create table public.booking_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  requested_status public.booking_status not null,
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_note text,
  decided_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_cancellation_requests_decision_check check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status in ('approved', 'rejected') and decided_by is not null and decided_at is not null)
  )
);

comment on table public.booking_cancellation_requests is
  'Customer cancellation requests. Booking status remains unchanged until an admin approves or rejects the request.';

create index booking_cancellation_requests_booking_created_idx
  on public.booking_cancellation_requests (booking_id, created_at desc);

create unique index booking_cancellation_requests_one_pending_idx
  on public.booking_cancellation_requests (booking_id)
  where status = 'pending';

create or replace function public.set_booking_cancellation_request_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger booking_cancellation_requests_updated_at
before update on public.booking_cancellation_requests
for each row execute function public.set_booking_cancellation_request_updated_at();

alter table public.booking_cancellation_requests enable row level security;

create policy "Customers and admins can view cancellation requests"
on public.booking_cancellation_requests
for select
to authenticated
using (
  customer_id = (select auth.uid())
  or (select private.is_admin())
);

revoke all on table public.booking_cancellation_requests from anon, authenticated;
grant select on table public.booking_cancellation_requests to authenticated;

-- Customer entry point. This records intent and alerts every active admin, but
-- does not change the booking or release its reserved units.
create or replace function public.request_booking_cancellation(
  p_booking_id uuid,
  p_reason text
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
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'INVALID_CANCELLATION_REASON';
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
    booking_id, customer_id, requested_status, reason
  ) values (
    v_booking.id, v_uid, v_booking.status, v_reason
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
    jsonb_build_object('cancellation_request_id', v_request.id, 'reason', v_reason),
    '{}'::jsonb, 'user'
  );

  return v_request;
exception
  when unique_violation then
    raise exception 'CANCELLATION_REQUEST_EXISTS';
end;
$$;

revoke all on function public.request_booking_cancellation(uuid, text) from public, anon;
grant execute on function public.request_booking_cancellation(uuid, text) to authenticated;

-- Admin decision entry point. Approval changes the booking to cancelled and
-- releases reservations in the same transaction. Rejection leaves the
-- booking's lifecycle status and reservations unchanged.
create or replace function public.review_booking_cancellation(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns public.booking_cancellation_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.booking_cancellation_requests;
  v_booking public.bookings;
  v_note text := nullif(btrim(coalesce(p_decision_note, '')), '');
  v_customer_message text;
begin
  if v_uid is null or not (select private.is_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'INVALID_CANCELLATION_DECISION';
  end if;

  if char_length(coalesce(p_decision_note, '')) > 1000 then
    raise exception 'DECISION_NOTE_TOO_LONG';
  end if;

  select * into v_request
  from public.booking_cancellation_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'CANCELLATION_REQUEST_NOT_FOUND';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'CANCELLATION_REQUEST_ALREADY_DECIDED';
  end if;

  select * into v_booking
  from public.bookings
  where id = v_request.booking_id
  for update;

  if v_booking.id is null or v_booking.customer_id <> v_request.customer_id then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  if p_decision = 'approved' then
    if v_booking.status <> v_request.requested_status
      or v_booking.status not in ('pending', 'approved') then
      raise exception 'BOOKING_STATUS_CHANGED';
    end if;

    update public.bookings
    set status = 'cancelled', cancelled_at = now()
    where id = v_booking.id;

    insert into public.booking_status_history (
      booking_id, from_status, to_status, note, changed_by
    ) values (
      v_booking.id,
      v_booking.status,
      'cancelled',
      'Cancellation request approved.' || case when v_note is not null then ' ' || v_note else '' end,
      v_uid
    );

    update public.unit_reservations ur
    set status = 'cancelled'::public.unit_reservation_status
    where ur.booking_item_id in (
      select bi.id from public.booking_items bi where bi.booking_id = v_booking.id
    ) and ur.status in ('tentative', 'confirmed');

    v_customer_message := 'Your cancellation request was approved. Booking ' || v_booking.booking_reference || ' was cancelled and its reserved dates were released.';
  else
    v_customer_message := 'Your cancellation request for booking ' || v_booking.booking_reference || ' was not approved. The booking remains active.';
  end if;

  update public.booking_cancellation_requests
  set status = p_decision,
      decision_note = v_note,
      decided_by = v_uid,
      decided_at = now()
  where id = v_request.id
  returning * into v_request;

  insert into public.notifications (
    user_id, notification_type, title, message, booking_id
  ) values (
    v_request.customer_id,
    'booking_cancellation_decision',
    'Cancellation request ' || case when p_decision = 'approved' then 'approved' else 'not approved' end,
    v_customer_message || case when v_note is not null then ' Admin note: ' || v_note else '' end,
    v_request.booking_id
  );

  perform private.log_audit_event(
    'booking.cancellation_' || p_decision,
    'booking', v_booking.id::text, v_booking.id,
    jsonb_build_object('booking_status', v_booking.status, 'request_id', v_request.id),
    jsonb_build_object('request_status', p_decision, 'decision_note', v_note),
    '{}'::jsonb, 'admin'
  );

  return v_request;
end;
$$;

revoke all on function public.review_booking_cancellation(uuid, text, text) from public, anon;
grant execute on function public.review_booking_cancellation(uuid, text, text) to authenticated;

commit;
