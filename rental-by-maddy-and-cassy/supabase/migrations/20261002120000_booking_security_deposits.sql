-- Security deposit: a refundable PHP 1,000 deposit the admin records as paid after pickup.
-- A released booking cannot move to its next status (returned) and its return cannot be
-- recorded until the deposit is on file. Additive only: no existing data is changed.
begin;

-- 1. One deposit record per booking. A row only exists once the deposit has been paid. -------
create table if not exists public.booking_security_deposits (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  amount numeric(12, 2) not null,
  payment_method text not null,
  reference_number text,
  paid_at timestamptz not null,
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now(),
  constraint booking_security_deposits_amount_check check (amount > 0),
  constraint booking_security_deposits_method_check
    check (payment_method in ('gcash', 'maya', 'bank_transfer', 'cash')),
  -- Digital payments need their reference number; cash never stores one. The explicit
  -- "is not null" matters: a NULL regex result would otherwise let the check pass.
  constraint booking_security_deposits_reference_check check (
    (payment_method = 'cash' and reference_number is null)
    or (
      payment_method <> 'cash'
      and reference_number is not null
      and reference_number ~ '^[A-Za-z0-9-]{4,120}$'
    )
  )
);

-- An older, unapplied design used this table name with other columns. Stop here rather than
-- continue against a table this migration did not create.
do $$
begin
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name = 'booking_security_deposits'
      and column_name in ('amount', 'payment_method', 'reference_number', 'paid_at', 'recorded_by', 'recorded_at')
  ) <> 6 then
    raise exception 'booking_security_deposits already exists with an unexpected shape';
  end if;
end;
$$;

-- 2. Row level security: admins read; writes go through the RPC below or the service role ----
alter table public.booking_security_deposits enable row level security;

drop policy if exists booking_security_deposits_admin_read on public.booking_security_deposits;
create policy booking_security_deposits_admin_read
on public.booking_security_deposits for select to authenticated
using ((select private.is_admin()));

revoke all on table public.booking_security_deposits from anon, authenticated;
grant select on table public.booking_security_deposits to authenticated;
grant all on table public.booking_security_deposits to service_role;

-- 3. Record the deposit as paid ------------------------------------------------------------------
create or replace function public.admin_record_security_deposit(
  p_booking_id uuid,
  p_method text,
  p_reference_number text,
  p_paid_at timestamptz
)
returns public.booking_security_deposits
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Fixed by the business (mirror of SECURITY_DEPOSIT_AMOUNT); the client never sends it.
  c_amount constant numeric(12, 2) := 1000;
  v_booking public.bookings;
  v_record public.booking_fulfillment_records;
  v_deposit public.booking_security_deposits;
  v_reference text := nullif(trim(coalesce(p_reference_number, '')), '');
begin
  v_booking := private.fulfillment_lock_booking(p_booking_id);
  if v_booking.status <> 'released' then
    raise exception 'DEPOSIT_NOT_READY';
  end if;
  select * into v_record from public.booking_fulfillment_records where booking_id = p_booking_id;
  if v_record.booking_id is null or not v_record.picked_up then
    raise exception 'DEPOSIT_NOT_READY';
  end if;
  if exists (select 1 from public.booking_security_deposits where booking_id = p_booking_id) then
    raise exception 'DEPOSIT_ALREADY_RECORDED';
  end if;
  if p_method is null or p_method not in ('gcash', 'maya', 'bank_transfer', 'cash') then
    raise exception 'INVALID_DEPOSIT_METHOD';
  end if;

  if p_method = 'cash' then
    v_reference := null;
  elsif v_reference is null then
    raise exception 'REFERENCE_REQUIRED';
  elsif v_reference !~ '^[A-Za-z0-9-]{4,120}$' then
    raise exception 'INVALID_REFERENCE';
  end if;

  if p_paid_at is null or p_paid_at > now() + interval '5 minutes' then
    raise exception 'INVALID_DATE';
  end if;

  insert into public.booking_security_deposits
    (booking_id, amount, payment_method, reference_number, paid_at, recorded_by)
  values (p_booking_id, c_amount, p_method, v_reference, p_paid_at, auth.uid())
  returning * into v_deposit;

  perform private.log_audit_event(
    'booking.security_deposit_paid', 'booking', p_booking_id::text, p_booking_id,
    null::jsonb,
    jsonb_build_object('amount', c_amount, 'method', p_method, 'referenceNumber', v_reference, 'paidAt', p_paid_at),
    '{}'::jsonb, 'admin'
  );
  return v_deposit;
end;
$$;

-- 4. Return: unchanged except that the deposit must be on file first -----------------------------
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
  if not exists (select 1 from public.booking_security_deposits where booking_id = p_booking_id) then
    raise exception 'SECURITY_DEPOSIT_REQUIRED';
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

-- 5. Status guard: a released booking cannot advance without a paid deposit ----------------------
-- Covers every path (Complete Rental, the status RPC, direct service-role updates).
create or replace function private.enforce_security_deposit_before_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'released'
     and new.status is distinct from old.status
     and not exists (
       select 1 from public.booking_security_deposits d where d.booking_id = new.id
     ) then
    raise exception 'SECURITY_DEPOSIT_REQUIRED';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_security_deposit_before_return on public.bookings;
create trigger enforce_security_deposit_before_return
before update of status on public.bookings
for each row
execute function private.enforce_security_deposit_before_return();

-- 6. Permissions ----------------------------------------------------------------------------------
revoke all on function public.admin_record_security_deposit(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.admin_record_security_deposit(uuid, text, text, timestamptz) to authenticated;
revoke all on function public.admin_record_return(uuid, timestamptz, text) from public, anon;
grant execute on function public.admin_record_return(uuid, timestamptz, text) to authenticated;

commit;
