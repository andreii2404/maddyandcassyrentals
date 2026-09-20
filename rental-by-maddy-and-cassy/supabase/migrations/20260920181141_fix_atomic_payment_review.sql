begin;

-- The application has referenced these columns since the normalized-schema
-- repair, but they are absent from the linked production database. Keep the
-- legacy names for type/API compatibility; PayMongo itself is no longer used.
alter table public.booking_payment_submissions
  add column if not exists paymongo_checkout_session_id text,
  add column if not exists paymongo_payment_id text,
  add column if not exists idempotency_key text,
  add column if not exists reviewer_name text;

alter table public.booking_payment_submissions
  drop constraint if exists booking_payment_submissions_reviewer_name_check;

alter table public.booking_payment_submissions
  add constraint booking_payment_submissions_reviewer_name_check
  check (
    reviewer_name is null
    or (char_length(btrim(reviewer_name)) between 1 and 120)
  );

create unique index if not exists booking_payment_submissions_idempotency_key_idx
  on public.booking_payment_submissions(idempotency_key)
  where idempotency_key is not null;

create unique index if not exists booking_payment_submissions_checkout_session_idx
  on public.booking_payment_submissions(paymongo_checkout_session_id)
  where paymongo_checkout_session_id is not null;

create index if not exists booking_payment_submissions_paymongo_payment_idx
  on public.booking_payment_submissions(paymongo_payment_id)
  where paymongo_payment_id is not null;

-- A GCash reference can only fund one verified payment. Rejected/submitted
-- attempts remain preserved for audit and resubmission history.
create unique index if not exists booking_payment_submissions_verified_reference_idx
  on public.booking_payment_submissions(external_reference)
  where status = 'verified' and external_reference is not null;

-- Performs the review decision and balance recomputation under the booking row
-- lock. This makes two simultaneous Verify clicks serialize, prevents a stale
-- pending submission from over-counting the balance, and ensures rejection and
-- verification use the same persisted state transition.
create or replace function public.review_manual_payment(
  p_booking_id uuid,
  p_payment_id uuid,
  p_status text,
  p_reviewed_by uuid default null,
  p_reason text default null,
  p_provider_payment_id text default null,
  p_payment_method text default null,
  p_provider_metadata jsonb default '{}'::jsonb,
  p_reviewer_name text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.booking_payment_submissions;
  v_total numeric(12,2);
  v_paid_before numeric(12,2);
  v_applied_amount numeric(12,2);
  v_paid_after numeric(12,2);
  v_balance numeric(12,2);
  v_now timestamptz := now();
begin
  if p_status not in ('verified', 'rejected') then
    raise exception 'INVALID_PAYMENT_REVIEW_STATUS';
  end if;

  if p_status = 'rejected' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'PAYMENT_REJECTION_REASON_REQUIRED';
  end if;

  if char_length(coalesce(p_reason, '')) > 1000 then
    raise exception 'PAYMENT_REVIEW_REASON_TOO_LONG';
  end if;

  if p_reviewer_name is not null and
     char_length(btrim(p_reviewer_name)) not between 1 and 120 then
    raise exception 'INVALID_PAYMENT_REVIEWER_NAME';
  end if;

  -- The booking lock is the serialization point for every payment review on a
  -- booking. Always acquire it before locking the individual payment row.
  perform 1
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  select *
  into v_payment
  from public.booking_payment_submissions
  where id = p_payment_id
    and booking_id = p_booking_id
  for update;

  if v_payment.id is null then
    raise exception 'PAYMENT_SUBMISSION_NOT_FOUND';
  end if;

  if v_payment.status not in ('submitted', 'under_review') then
    raise exception 'PAYMENT_ALREADY_REVIEWED';
  end if;

  select bt.total_amount
  into v_total
  from public.booking_totals bt
  where bt.booking_id = p_booking_id;

  if v_total is null then
    raise exception 'BOOKING_TOTAL_NOT_FOUND';
  end if;

  select coalesce(sum(payment.declared_amount), 0)
  into v_paid_before
  from public.booking_payment_submissions payment
  where payment.booking_id = p_booking_id
    and payment.status = 'verified';

  if p_status = 'rejected' then
    update public.booking_payment_submissions
    set status = 'rejected',
        review_notes = btrim(p_reason),
        reviewed_by = p_reviewed_by,
        reviewer_name = nullif(btrim(p_reviewer_name), ''),
        reviewed_at = v_now
    where id = v_payment.id;

    return jsonb_build_object(
      'paymentId', v_payment.id,
      'bookingId', p_booking_id,
      'status', 'rejected',
      'verifiedAmount', v_paid_before,
      'remainingBalance', greatest(v_total - v_paid_before, 0),
      'fullyPaid', v_paid_before >= v_total - 0.01
    );
  end if;

  if v_payment.external_reference is not null and exists (
    select 1
    from public.booking_payment_submissions other
    where other.id <> v_payment.id
      and other.status = 'verified'
      and other.external_reference = v_payment.external_reference
  ) then
    raise exception 'DUPLICATE_PAYMENT_REFERENCE';
  end if;

  v_balance := greatest(v_total - v_paid_before, 0);
  if v_balance <= 0.01 then
    raise exception 'BOOKING_ALREADY_PAID';
  end if;

  -- declared_amount is selected by the application from the balance at submit
  -- time. If another pending payment was verified first, apply only today's
  -- remaining balance so verified revenue can never exceed the booking total.
  v_applied_amount := least(v_payment.declared_amount, v_balance);
  v_paid_after := v_paid_before + v_applied_amount;
  v_balance := greatest(v_total - v_paid_after, 0);

  update public.booking_payment_submissions
  set status = 'verified',
      declared_amount = v_applied_amount,
      paymongo_payment_id = coalesce(nullif(p_provider_payment_id, ''), external_reference, id::text),
      payment_method = coalesce(nullif(p_payment_method, ''), payment_method, 'gcash'),
      provider_metadata = coalesce(provider_metadata, '{}'::jsonb) || coalesce(p_provider_metadata, '{}'::jsonb),
      review_notes = null,
      reviewed_by = p_reviewed_by,
      reviewer_name = nullif(btrim(p_reviewer_name), ''),
      reviewed_at = v_now,
      completed_at = v_now
  where id = v_payment.id;

  return jsonb_build_object(
    'paymentId', v_payment.id,
    'bookingId', p_booking_id,
    'status', 'verified',
    'appliedAmount', v_applied_amount,
    'verifiedAmount', v_paid_after,
    'remainingBalance', v_balance,
    'fullyPaid', v_balance <= 0.01
  );
end;
$$;

revoke all on function public.review_manual_payment(uuid, uuid, text, uuid, text, text, text, jsonb, text) from public;
revoke all on function public.review_manual_payment(uuid, uuid, text, uuid, text, text, text, jsonb, text) from anon;
revoke all on function public.review_manual_payment(uuid, uuid, text, uuid, text, text, text, jsonb, text) from authenticated;
grant execute on function public.review_manual_payment(uuid, uuid, text, uuid, text, text, text, jsonb, text) to service_role;

comment on function public.review_manual_payment(uuid, uuid, text, uuid, text, text, text, jsonb, text) is
  'Atomically verifies or rejects a manual payment and returns authoritative paid/balance totals. Service-role only.';

-- Payment changes must be broadcast so open admin and customer booking pages
-- reload the authoritative database state immediately.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'booking_payment_submissions'
  ) then
    alter publication supabase_realtime add table public.booking_payment_submissions;
  end if;
end
$$;

commit;
