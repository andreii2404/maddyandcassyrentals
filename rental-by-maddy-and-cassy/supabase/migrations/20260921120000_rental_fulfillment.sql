-- Rental Fulfillment: post-approval pickup/return/condition/charges/customer updates and a
-- guarded, idempotent "Complete Rental". Additive only: no existing column, row content,
-- payment, document, agreement or loyalty data is changed or removed.
begin;

-- 1. Email tracking on bookings ---------------------------------------------------------
alter table public.bookings
  add column if not exists approval_email_status text,
  add column if not exists approval_email_sent_at timestamptz,
  add column if not exists completion_email_sent_at timestamptz,
  add column if not exists completion_email_to text;

alter table public.bookings drop constraint if exists bookings_approval_email_status_check;
alter table public.bookings add constraint bookings_approval_email_status_check
  check (approval_email_status is null or approval_email_status in ('sent', 'failed', 'legacy'));

-- Bookings approved before tracking existed: delivery is unknown, so mark them legacy. Only the
-- new column is filled in. The release guard trigger runs on "update of status" only.
update public.bookings
set approval_email_status = 'legacy'
where approved_at is not null and approval_email_status is null;

-- 2. Fulfillment records (one per booking) ------------------------------------------------
create table if not exists public.booking_fulfillment_records (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  picked_up boolean not null default false,
  actual_pickup_at timestamptz,
  pickup_notes text,
  returned boolean not null default false,
  actual_return_at timestamptz,
  return_notes text,
  item_condition text,
  condition_notes text,
  condition_photo_paths text[] not null default '{}',
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_fulfillment_condition_check
    check (item_condition is null or item_condition in ('good', 'damaged')),
  constraint booking_fulfillment_pickup_check
    check (not picked_up or actual_pickup_at is not null),
  constraint booking_fulfillment_return_check
    check (not returned or actual_return_at is not null),
  constraint booking_fulfillment_photos_check
    check (coalesce(array_length(condition_photo_paths, 1), 0) <= 6)
);

-- 3. Extra charges (void, never delete) ---------------------------------------------------
create table if not exists public.booking_charges (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  charge_type text not null,
  amount numeric(12, 2) not null,
  reason text not null,
  payment_status text not null default 'unpaid',
  payment_method text,
  paid_at timestamptz,
  paid_recorded_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text,
  constraint booking_charges_type_check check (charge_type in ('late_fee', 'damage_fee', 'other')),
  constraint booking_charges_amount_check check (amount > 0 and amount <= 1000000),
  constraint booking_charges_reason_check check (length(trim(reason)) >= 3),
  constraint booking_charges_payment_status_check check (payment_status in ('unpaid', 'paid')),
  constraint booking_charges_method_check
    check (payment_method is null or payment_method in ('cash', 'gcash', 'other')),
  constraint booking_charges_paid_consistency check (
    (payment_status = 'paid' and payment_method is not null and paid_at is not null)
    or (payment_status = 'unpaid' and payment_method is null and paid_at is null)
  ),
  constraint booking_charges_void_consistency check (
    voided_at is null or (void_reason is not null and length(trim(void_reason)) >= 3)
  )
);

create index if not exists booking_charges_booking_idx on public.booking_charges (booking_id, created_at);

-- 4. Customer updates (email history) -----------------------------------------------------
create table if not exists public.booking_customer_updates (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  subject text not null,
  message text not null,
  sent_to text,
  sent_by uuid references auth.users(id),
  admin_note text,
  related_charge_id uuid references public.booking_charges(id) on delete set null,
  delivery_status text not null default 'failed',
  delivery_attempts integer not null default 0,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint booking_customer_updates_status_check check (delivery_status in ('sent', 'failed')),
  constraint booking_customer_updates_subject_check check (length(trim(subject)) between 1 and 150),
  constraint booking_customer_updates_message_check check (length(trim(message)) between 1 and 5000)
);

create index if not exists booking_customer_updates_booking_idx
  on public.booking_customer_updates (booking_id, created_at desc);

-- 5. Row level security: admins read; writes go through the RPCs below or the service role -
alter table public.booking_fulfillment_records enable row level security;
alter table public.booking_charges enable row level security;
alter table public.booking_customer_updates enable row level security;

drop policy if exists booking_fulfillment_records_admin_read on public.booking_fulfillment_records;
create policy booking_fulfillment_records_admin_read
on public.booking_fulfillment_records for select to authenticated
using ((select private.is_admin()));

drop policy if exists booking_charges_admin_read on public.booking_charges;
create policy booking_charges_admin_read
on public.booking_charges for select to authenticated
using ((select private.is_admin()));

drop policy if exists booking_customer_updates_admin_read on public.booking_customer_updates;
create policy booking_customer_updates_admin_read
on public.booking_customer_updates for select to authenticated
using ((select private.is_admin()));

revoke all on table public.booking_fulfillment_records from anon, authenticated;
revoke all on table public.booking_charges from anon, authenticated;
revoke all on table public.booking_customer_updates from anon, authenticated;
grant select on table public.booking_fulfillment_records to authenticated;
grant select on table public.booking_charges to authenticated;
grant select on table public.booking_customer_updates to authenticated;
grant all on table public.booking_fulfillment_records to service_role;
grant all on table public.booking_charges to service_role;
grant all on table public.booking_customer_updates to service_role;

-- 6. Private storage bucket for condition photos ------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'condition-photos', 'condition-photos', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists condition_photos_admin_insert on storage.objects;
create policy condition_photos_admin_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'condition-photos' and (select private.is_admin()));

drop policy if exists condition_photos_admin_read on storage.objects;
create policy condition_photos_admin_read
on storage.objects for select to authenticated
using (bucket_id = 'condition-photos' and (select private.is_admin()));

-- 7. Helpers -------------------------------------------------------------------------------
create or replace function private.fulfillment_assert_admin()
returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select private.is_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.fulfillment_lock_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
set search_path = ''
as $$
declare
  v_booking public.bookings;
begin
  perform private.fulfillment_assert_admin();
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  return v_booking;
end;
$$;

revoke all on function private.fulfillment_assert_admin() from public, anon, authenticated;
revoke all on function private.fulfillment_lock_booking(uuid) from public, anon, authenticated;

-- 8. Pickup: uses the existing released transition, so the balance guard still applies ------
create or replace function public.admin_record_pickup(
  p_booking_id uuid,
  p_picked_up_at timestamptz,
  p_notes text default null
)
returns public.booking_fulfillment_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_record public.booking_fulfillment_records;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  v_booking := private.fulfillment_lock_booking(p_booking_id);
  if v_booking.status not in ('ready_for_release', 'released') then
    raise exception 'PICKUP_NOT_READY';
  end if;
  if p_picked_up_at is null or p_picked_up_at > now() + interval '5 minutes' then
    raise exception 'INVALID_DATE';
  end if;

  if v_booking.status = 'ready_for_release' then
    -- Raises BALANCE_PAYMENT_REQUIRED from the existing trigger when a balance is still due.
    perform public.admin_set_booking_status(p_booking_id, 'released', v_notes);
  end if;

  insert into public.booking_fulfillment_records
    (booking_id, picked_up, actual_pickup_at, pickup_notes, updated_by)
  values (p_booking_id, true, p_picked_up_at, v_notes, auth.uid())
  on conflict (booking_id) do update set
    picked_up = true,
    actual_pickup_at = excluded.actual_pickup_at,
    pickup_notes = excluded.pickup_notes,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into v_record;

  perform private.log_audit_event(
    'booking.pickup_recorded', 'booking', p_booking_id::text, p_booking_id,
    null::jsonb, jsonb_build_object('pickedUpAt', p_picked_up_at),
    jsonb_build_object('note', v_notes), 'admin'
  );
  return v_record;
end;
$$;

-- 9. Return -----------------------------------------------------------------------------------
create or replace function public.admin_record_return(
  p_booking_id uuid,
  p_returned_at timestamptz,
  p_notes text default null
)
returns public.booking_fulfillment_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_record public.booking_fulfillment_records;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  v_booking := private.fulfillment_lock_booking(p_booking_id);
  if v_booking.status <> 'released' then
    raise exception 'RETURN_NOT_READY';
  end if;
  select * into v_record from public.booking_fulfillment_records where booking_id = p_booking_id;
  if v_record.booking_id is null or not v_record.picked_up then
    raise exception 'RETURN_NOT_READY';
  end if;
  if p_returned_at is null or p_returned_at > now() + interval '5 minutes' then
    raise exception 'INVALID_DATE';
  end if;
  if p_returned_at < v_record.actual_pickup_at then
    raise exception 'RETURN_BEFORE_PICKUP';
  end if;

  update public.booking_fulfillment_records
  set returned = true,
      actual_return_at = p_returned_at,
      return_notes = v_notes,
      updated_by = auth.uid(),
      updated_at = now()
  where booking_id = p_booking_id
  returning * into v_record;

  perform private.log_audit_event(
    'booking.return_recorded', 'booking', p_booking_id::text, p_booking_id,
    null::jsonb, jsonb_build_object('returnedAt', p_returned_at),
    jsonb_build_object('note', v_notes), 'admin'
  );
  return v_record;
end;
$$;

-- 10. Item condition --------------------------------------------------------------------------
create or replace function public.admin_save_item_condition(
  p_booking_id uuid,
  p_condition text,
  p_notes text default null,
  p_photo_paths text[] default '{}'
)
returns public.booking_fulfillment_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_record public.booking_fulfillment_records;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_paths text[] := coalesce(p_photo_paths, '{}');
begin
  v_booking := private.fulfillment_lock_booking(p_booking_id);
  if v_booking.status <> 'released' then
    raise exception 'CONDITION_NOT_READY';
  end if;
  if p_condition is null or p_condition not in ('good', 'damaged') then
    raise exception 'INVALID_CONDITION';
  end if;
  if p_condition = 'damaged' and v_notes is null then
    raise exception 'DAMAGE_NOTES_REQUIRED';
  end if;
  if coalesce(array_length(v_paths, 1), 0) > 6 then
    raise exception 'TOO_MANY_PHOTOS';
  end if;
  if exists (
    select 1 from unnest(v_paths) as photo(photo_path)
    where photo_path not like p_booking_id::text || '/%'
  ) then
    raise exception 'INVALID_PHOTO_PATH';
  end if;

  insert into public.booking_fulfillment_records
    (booking_id, item_condition, condition_notes, condition_photo_paths, updated_by)
  values (p_booking_id, p_condition, v_notes, v_paths, auth.uid())
  on conflict (booking_id) do update set
    item_condition = excluded.item_condition,
    condition_notes = excluded.condition_notes,
    condition_photo_paths = excluded.condition_photo_paths,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into v_record;

  perform private.log_audit_event(
    'booking.condition_recorded', 'booking', p_booking_id::text, p_booking_id,
    null::jsonb, jsonb_build_object('condition', p_condition, 'photoCount', coalesce(array_length(v_paths, 1), 0)),
    jsonb_build_object('note', v_notes), 'admin'
  );
  return v_record;
end;
$$;

-- 11. Charges ---------------------------------------------------------------------------------
create or replace function public.admin_add_booking_charge(
  p_booking_id uuid,
  p_charge_type text,
  p_amount numeric,
  p_reason text
)
returns public.booking_charges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_charge public.booking_charges;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  v_booking := private.fulfillment_lock_booking(p_booking_id);
  if v_booking.status not in ('confirmed', 'ready_for_release', 'released') then
    raise exception 'CHARGE_NOT_ALLOWED';
  end if;
  if p_charge_type is null or p_charge_type not in ('late_fee', 'damage_fee', 'other') then
    raise exception 'INVALID_CHARGE_TYPE';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if length(v_reason) < 3 then
    raise exception 'REASON_REQUIRED';
  end if;

  insert into public.booking_charges (booking_id, charge_type, amount, reason, created_by)
  values (p_booking_id, p_charge_type, round(p_amount, 2), v_reason, auth.uid())
  returning * into v_charge;

  perform private.log_audit_event(
    'booking.charge_added', 'booking', p_booking_id::text, p_booking_id,
    null::jsonb, jsonb_build_object('chargeId', v_charge.id, 'type', p_charge_type, 'amount', v_charge.amount),
    jsonb_build_object('reason', v_reason), 'admin'
  );
  return v_charge;
end;
$$;

create or replace function public.admin_mark_charge_paid(
  p_charge_id uuid,
  p_method text,
  p_paid_at timestamptz
)
returns public.booking_charges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
  v_booking public.bookings;
  v_charge public.booking_charges;
begin
  perform private.fulfillment_assert_admin();
  select booking_id into v_booking_id from public.booking_charges where id = p_charge_id;
  if v_booking_id is null then
    raise exception 'CHARGE_NOT_FOUND';
  end if;
  v_booking := private.fulfillment_lock_booking(v_booking_id);
  if v_booking.status in ('returned', 'cancelled', 'rejected') then
    raise exception 'RENTAL_COMPLETED';
  end if;
  select * into v_charge from public.booking_charges where id = p_charge_id for update;
  if v_charge.voided_at is not null then
    raise exception 'CHARGE_VOIDED';
  end if;
  if v_charge.payment_status = 'paid' then
    raise exception 'CHARGE_ALREADY_PAID';
  end if;
  if p_method is null or p_method not in ('cash', 'gcash', 'other') then
    raise exception 'INVALID_METHOD';
  end if;
  if p_paid_at is null or p_paid_at > now() + interval '5 minutes' then
    raise exception 'INVALID_DATE';
  end if;

  update public.booking_charges
  set payment_status = 'paid',
      payment_method = p_method,
      paid_at = p_paid_at,
      paid_recorded_by = auth.uid()
  where id = p_charge_id
  returning * into v_charge;

  perform private.log_audit_event(
    'booking.charge_paid', 'booking', v_booking_id::text, v_booking_id,
    null::jsonb, jsonb_build_object('chargeId', p_charge_id, 'method', p_method, 'amount', v_charge.amount),
    '{}'::jsonb, 'admin'
  );
  return v_charge;
end;
$$;

create or replace function public.admin_void_booking_charge(
  p_charge_id uuid,
  p_reason text
)
returns public.booking_charges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
  v_booking public.bookings;
  v_charge public.booking_charges;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  perform private.fulfillment_assert_admin();
  select booking_id into v_booking_id from public.booking_charges where id = p_charge_id;
  if v_booking_id is null then
    raise exception 'CHARGE_NOT_FOUND';
  end if;
  v_booking := private.fulfillment_lock_booking(v_booking_id);
  if v_booking.status in ('returned', 'cancelled', 'rejected') then
    raise exception 'RENTAL_COMPLETED';
  end if;
  select * into v_charge from public.booking_charges where id = p_charge_id for update;
  if v_charge.voided_at is not null then
    raise exception 'CHARGE_VOIDED';
  end if;
  if length(v_reason) < 3 then
    raise exception 'REASON_REQUIRED';
  end if;

  update public.booking_charges
  set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
  where id = p_charge_id
  returning * into v_charge;

  perform private.log_audit_event(
    'booking.charge_voided', 'booking', v_booking_id::text, v_booking_id,
    null::jsonb, jsonb_build_object('chargeId', p_charge_id, 'amount', v_charge.amount),
    jsonb_build_object('reason', v_reason), 'admin'
  );
  return v_charge;
end;
$$;

-- 12. Complete Rental: transactional and idempotent ---------------------------------------------
-- Loyalty needs no write here: the existing rule counts bookings whose status is 'returned', and
-- the reward is single-use per account, so a retry can never award anything twice.
create or replace function public.admin_complete_rental(
  p_booking_id uuid,
  p_note text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_record public.booking_fulfillment_records;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_unpaid_charges integer := 0;
  v_pending_reviews integer := 0;
begin
  v_booking := private.fulfillment_lock_booking(p_booking_id);

  -- Already completed: a repeat call changes nothing.
  if v_booking.status = 'returned' then
    return v_booking;
  end if;
  if v_booking.status <> 'released' then
    raise exception 'COMPLETION_BLOCKED';
  end if;

  select * into v_record from public.booking_fulfillment_records where booking_id = p_booking_id;
  if v_record.booking_id is null
     or not v_record.picked_up
     or not v_record.returned
     or v_record.item_condition is null then
    raise exception 'COMPLETION_BLOCKED';
  end if;

  select coalesce(bt.total_amount, 0) into v_total
  from public.booking_totals bt where bt.booking_id = p_booking_id;

  select coalesce(sum(bps.declared_amount), 0) into v_paid
  from public.booking_payment_submissions bps
  where bps.booking_id = p_booking_id and bps.status = 'verified';
  if v_paid < v_total - 0.01 then
    raise exception 'COMPLETION_BLOCKED';
  end if;

  select count(*) into v_unpaid_charges
  from public.booking_charges c
  where c.booking_id = p_booking_id and c.voided_at is null and c.payment_status <> 'paid';
  if v_unpaid_charges > 0 then
    raise exception 'COMPLETION_BLOCKED';
  end if;

  select count(*) into v_pending_reviews
  from public.booking_payment_submissions bps
  where bps.booking_id = p_booking_id and bps.status in ('submitted', 'under_review');
  if v_pending_reviews > 0 then
    raise exception 'COMPLETION_BLOCKED';
  end if;

  -- Existing transition: sets returned_at, frees reservations, writes history and notification.
  perform public.admin_set_booking_status(p_booking_id, 'returned', nullif(trim(coalesce(p_note, '')), ''));
  select * into v_booking from public.bookings where id = p_booking_id;

  perform private.log_audit_event(
    'booking.rental_completed', 'booking', p_booking_id::text, p_booking_id,
    null::jsonb, jsonb_build_object('status', 'returned'),
    jsonb_build_object('note', nullif(trim(coalesce(p_note, '')), '')), 'admin'
  );
  return v_booking;
end;
$$;

-- 13. Permissions ---------------------------------------------------------------------------------
revoke all on function public.admin_record_pickup(uuid, timestamptz, text) from public, anon;
revoke all on function public.admin_record_return(uuid, timestamptz, text) from public, anon;
revoke all on function public.admin_save_item_condition(uuid, text, text, text[]) from public, anon;
revoke all on function public.admin_add_booking_charge(uuid, text, numeric, text) from public, anon;
revoke all on function public.admin_mark_charge_paid(uuid, text, timestamptz) from public, anon;
revoke all on function public.admin_void_booking_charge(uuid, text) from public, anon;
revoke all on function public.admin_complete_rental(uuid, text) from public, anon;

grant execute on function public.admin_record_pickup(uuid, timestamptz, text) to authenticated;
grant execute on function public.admin_record_return(uuid, timestamptz, text) to authenticated;
grant execute on function public.admin_save_item_condition(uuid, text, text, text[]) to authenticated;
grant execute on function public.admin_add_booking_charge(uuid, text, numeric, text) to authenticated;
grant execute on function public.admin_mark_charge_paid(uuid, text, timestamptz) to authenticated;
grant execute on function public.admin_void_booking_charge(uuid, text) to authenticated;
grant execute on function public.admin_complete_rental(uuid, text) to authenticated;

commit;
