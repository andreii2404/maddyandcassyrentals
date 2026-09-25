# Rental Lifecycle Addendum: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend the rental fulfillment plan (`2026-09-21-rental-fulfillment.md`) to cover the full lifecycle from spec section 11: a refundable security deposit kept separate from the rental payment, lifecycle emails (Ready for Pickup, Picked Up, Return Reminder, Returned) whose results are saved, deposit resolution at completion, and the audit fixes.

**Spec:** `docs/superpowers/specs/2026-09-21-rental-fulfillment-design.md`, section 11 (wins over sections 1-10 when they conflict).

## Execution order

1. **Task A** (this file): lifecycle fixes. Independent, done first.
2. **Tasks 3-13** of `2026-09-21-rental-fulfillment.md`, exactly as written.
3. **Tasks 15-20** (this file), in order.
4. **Task 14** of the original plan, extended by "Task 14 additions" at the end of this file.

## Global constraints (in addition to the original plan's)

- Additive only. Never delete or rewrite existing bookings, payments, receipts, documents, agreements, loyalty data, products or customers. `products.refundable_deposit` and `booking_items.deposit_per_unit_snapshot` stay as they are.
- Security deposit = `SECURITY_DEPOSIT_PER_DEVICE` (1000) x the sum of `booking_items.quantity`. Only `src/lib/securityDeposit.ts` and the SQL function `private.security_deposit_required` hold the number.
- The deposit is never part of `totalAmount` or `booking_totals.total_amount` again.
- Emails never throw and never roll back a status change. Every lifecycle email attempt is saved in `booking_email_events`.
- Applying migrations to the live project needs the user's explicit go-ahead (Task 14).
- Keep the code style of the files you touch. Customer text is simple and friendly. No arrows and no live-update indicators in new UI.
- Leave the existing auto-reject route (`app/api/admin/bookings/[bookingId]/auto-reject/route.ts`) and `autoRejectBookingForMissingRequirements` in place. Only stop calling them.

---

### Task A: Lifecycle fixes (approval gate, auto-reject removal, auto-confirm birthday check, error messages)

**Files:**
- Modify: `src/lib/bookingManagement.ts`, `scripts/testBookingManagement.ts`
- Create: `src/lib/autoConfirm.ts`. Modify: `scripts/testPayments.ts`
- Modify: `src/lib/server/paymentFulfillment.ts`
- Modify: `app/api/admin/bookings/[bookingId]/route.ts`
- Modify: `src/services/adminBookingService.ts` (the `pending` "Approve Booking" description only)
- Modify: `app/admin/bookings/[bookingId]/AdminBookingDetail.tsx`
- Modify: `src/lib/bookingApprovalEmailDetails.ts`, `src/lib/bookingStatusEmailContent.ts`

- [ ] **Step 1: Failing tests for the pure helpers.** In `scripts/testBookingManagement.ts` add tests for two new exports of `src/lib/bookingManagement.ts`:
  - `getApprovalBlockers({ requirementsStatus, hasVerifiedPayment, agreementStatus }): string[]` returns, in this order, only the unmet items:
    - `"Verify at least one payment."` when `!hasVerifiedPayment`
    - `"Approve every required verification document."` when `requirementsStatus !== "approved"`
    - `"Countersign the rental agreement."` when `agreementStatus !== "completed"`

    All met: `[]`.
  - `getPendingStageLabel({ status, requirementsStatus, paymentProofSubmitted }): string | null` returns `null` unless `status === "pending"`. Otherwise:
    - `"Awaiting Payment"` when no payment proof has been submitted
    - `"Pending Requirements"` when payment proof is submitted and `requirementsStatus === "not_submitted"`
    - `"Under Review"` otherwise

  In `scripts/testPayments.ts` add tests for `canAutoConfirmAfterPayment({ bookingStatus, agreementStatus, birthdayDiscountAmount, birthdayDiscountStatus })` from the new file `src/lib/autoConfirm.ts`. It is true only when `bookingStatus === "approved"`, `agreementStatus === "completed"`, and (`birthdayDiscountAmount <= 0` or `birthdayDiscountStatus === "verified"`). Cover: all good gives true; pending gives false; agreement incomplete gives false; birthday 100 + `pending_verification` gives false; birthday 100 + `verified` gives true.
- [ ] **Step 2:** Run `npm run test:bookings` and `npm run test:payments`. Expect FAIL (missing exports).
- [ ] **Step 3: Implement** the three helpers. `autoConfirm.ts` must not import `server-only`.
- [ ] **Step 4:** Run both test scripts again. Expect PASS.
- [ ] **Step 5: Auto-confirm birthday check.** In `src/lib/server/paymentFulfillment.ts`, replace `if (agreementRow?.status === "completed" && booking.status === "approved")` with a call to `canAutoConfirmAfterPayment({ bookingStatus: booking.status, agreementStatus: agreementRow?.status ?? "", birthdayDiscountAmount: booking.birthdayDiscountAmount, birthdayDiscountStatus: booking.birthdayDiscountStatus })`. Nothing else changes. The booking stays `approved` and the admin confirms manually after verifying the birthday.
- [ ] **Step 6: PATCH route** (`app/api/admin/bookings/[bookingId]/route.ts`):
  - **Approval gate.** When `targetStatus === "approved"`, before the RPC, load the booking with `getBookingById(supabase, bookingId)` (from `@/src/services/bookingService`) and check for a verified payment (`booking_payment_submissions`, `status = 'verified'`, limit 1). Run `getApprovalBlockers`. If anything is returned, respond 409 with `"Finish these steps before approving: " + blockers.join(" ")`. If the booking is missing, keep the existing 404 wording.
  - **New error mappings,** next to the existing ones:
    - `INVENTORY_NOT_RESERVED` gives 409 `"The reserved units for this booking are no longer held, so it can't be confirmed. Check the unit assignments on the booking, then try again."`
    - `SECURITY_DEPOSIT_REQUIRED` gives 409 `"Record the security deposit before releasing the item."`
  - **Pay-later wording.** Change the `BALANCE_PAYMENT_REQUIRED` message to exactly `"The remaining balance must be recorded as paid before handover."`
- [ ] **Step 7: Admin UI** (`AdminBookingDetail.tsx`):
  - **Remove auto-reject.** Delete the auto-reject `useRef`/`useEffect` block (the comment "A pending booking that reached the requirements step..." through the end of that effect). Delete the imports that become unused (`autoRejectBookingForMissingRequirements`, `shouldAutoRejectForMissingRequirements`, and `PAYMENT_PROOF_SUBMITTED_STATUSES` if nothing else uses it). Keep `AUTO_REJECT_DECLINE_DETAILS`: it still labels old auto-rejected records.
  - **Pending stage label.** `finalDecisionLabel` for `pending`: keep `"Ready for Approval"` when `remainingChecks === 0`. Otherwise use `getPendingStageLabel(...)`, with `paymentProofSubmitted` = any payment whose status is `submitted`, `under_review` or `verified`.
  - **Approval gate in the UI.** Compute `approvalBlockers = getApprovalBlockers({ requirementsStatus: booking.requirementsStatus, hasVerifiedPayment: amountPaid > 0, agreementStatus: booking.agreementStatus })`. In `renderActionChoice`, disable the `approved` card when `approvalBlockers.length > 0` (same pattern as `blockedByBalance`). Under the action grid, when the Approve card is present and blocked, render `<p className={styles.choosePrompt}>` with `"Approval is available once: " + approvalBlockers.join(" ")`.
  - **Agreement tab.** The "Next admin step" line for `pending` (near line 1095) becomes: `Approve the booking now that the agreement is complete, then confirm it.`
- [ ] **Step 8: Approval email.**
  - In `bookingApprovalEmailDetails.ts`, replace the pay-later ternary with the single string `"Pay the remaining balance before handover"`.
  - In `bookingStatusEmailContent.ts`, the approved `nextCopy` (both guest and account variants) must no longer promise documents or agreement steps unconditionally. Use: `details.remainingAction ? <existing sentence> : "Everything is in order. We will email you again when your rental is ready for pickup."` Keep the guest/account wording difference for the existing sentence.
  - In `adminBookingService.ts`, the pending "Approve Booking" description becomes: `"Accept the request once the payment is verified, documents are approved and the agreement is countersigned."`
- [ ] **Step 9:** Run `npx tsc --noEmit && npm run lint && npm run test:bookings && npm run test:payments`. Expect PASS.
- [ ] **Step 10: Commit.** `git commit -m "fix: gate approval, stop auto-reject on open, check birthday before auto-confirm"`

---

### Task 15: Security deposit and lifecycle email migration + types

**Files:**
- Create: `supabase/migrations/20260925120000_security_deposit_and_lifecycle_emails.sql` (runs after `20260921120000_rental_fulfillment.sql` from Task 3)
- Modify: `src/lib/supabase/database.types.ts`

- [ ] **Step 1: Write the migration exactly as below.** Before writing, open `20260921120000_rental_fulfillment.sql`. If Task 3 changed the body of `admin_void_booking_charge` or `admin_complete_rental`, carry those changes into the replacements below. Only the lines marked `-- NEW` are new.

```sql
-- Security deposit (refundable, separate from the rental payment) and lifecycle email log.
-- Additive: no existing row is changed. Live data on 2026-09-25 has deposit_total = 0 on every
-- booking, so removing the deposit from total_amount changes no existing total or balance.
begin;

-- 1. The rental total no longer includes the deposit (deposit_total column kept) ------------
create or replace view public.booking_totals
with (security_invoker = true)
as
select
  b.id as booking_id,
  upper(b.rental_period) - lower(b.rental_period) as rental_days,
  coalesce(sum(
    bi.quantity::numeric * bi.daily_rate_snapshot
      * (upper(b.rental_period) - lower(b.rental_period))::numeric
  ), 0::numeric)::numeric(12,2)
    as rental_subtotal,
  coalesce(sum(bi.quantity::numeric * bi.deposit_per_unit_snapshot), 0::numeric)::numeric(12,2)
    as deposit_total,
  coalesce(bf.delivery_fee_snapshot, 0::numeric)::numeric(12,2) as delivery_fee,
  greatest(
    coalesce(sum(
      bi.quantity::numeric * bi.daily_rate_snapshot
        * (upper(b.rental_period) - lower(b.rental_period))::numeric
    ), 0::numeric)
    + coalesce(bf.delivery_fee_snapshot, 0::numeric)
    + coalesce(bf.pickup_convenience_fee_snapshot, 0::numeric)
    - b.birthday_discount_amount
    - b.loyalty_discount_amount,
    0::numeric
  )::numeric(12,2) as total_amount,
  (b.birthday_discount_amount + b.loyalty_discount_amount)::numeric(12,2)
    as special_discount_total,
  coalesce(bf.pickup_convenience_fee_snapshot, 0::numeric)::numeric(12,2)
    as pickup_convenience_fee
from public.bookings b
left join public.booking_items bi on bi.booking_id = b.id
left join public.booking_fulfillments bf on bf.booking_id = b.id
group by b.id, bf.delivery_fee_snapshot, bf.pickup_convenience_fee_snapshot,
  b.rental_period, b.birthday_discount_amount, b.loyalty_discount_amount;

-- 2. Required deposit: PHP 1,000 per rented device (mirror of SECURITY_DEPOSIT_PER_DEVICE) --
create or replace function private.security_deposit_required(p_booking_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select (1000 * coalesce(sum(bi.quantity), 0))::numeric(12,2)
  from public.booking_items bi
  where bi.booking_id = p_booking_id;
$$;

revoke all on function private.security_deposit_required(uuid) from public, anon, authenticated;

-- 3. Deposit record (no row = Not Paid) ----------------------------------------------------
create table if not exists public.booking_security_deposits (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  required_amount numeric(12, 2) not null,
  status text not null default 'held',
  collected_amount numeric(12, 2) not null,
  collected_method text not null,
  collected_reference text,
  collected_at timestamptz not null,
  collected_by uuid references auth.users(id),
  deducted_amount numeric(12, 2) not null default 0,
  refunded_amount numeric(12, 2) not null default 0,
  refund_method text,
  refund_reference text,
  refunded_at timestamptz,
  resolution_note text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_security_deposits_status_check
    check (status in ('held', 'refunded', 'partially_deducted', 'fully_deducted')),
  constraint booking_security_deposits_amount_check
    check (required_amount > 0 and collected_amount = required_amount),
  constraint booking_security_deposits_method_check
    check (collected_method in ('cash', 'gcash', 'other')),
  constraint booking_security_deposits_refund_method_check
    check (refund_method is null or refund_method in ('cash', 'gcash', 'other')),
  constraint booking_security_deposits_resolution_check check (
    (status = 'held' and resolved_at is null and deducted_amount = 0 and refunded_amount = 0)
    or (
      status <> 'held'
      and resolved_at is not null
      and deducted_amount >= 0
      and refunded_amount >= 0
      and deducted_amount + refunded_amount = collected_amount
      and (status <> 'refunded' or deducted_amount = 0)
      and (status <> 'fully_deducted' or refunded_amount = 0)
      and (status <> 'partially_deducted' or (deducted_amount > 0 and refunded_amount > 0))
      and (refunded_amount = 0 or (refund_method is not null and refunded_at is not null))
    )
  )
);

alter table public.booking_security_deposits enable row level security;

drop policy if exists booking_security_deposits_read on public.booking_security_deposits;
create policy booking_security_deposits_read
on public.booking_security_deposits for select to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1 from public.bookings b
    where b.id = booking_security_deposits.booking_id
      and b.customer_id = (select auth.uid())
  )
);

revoke all on table public.booking_security_deposits from anon, authenticated;
grant select on table public.booking_security_deposits to authenticated;
grant all on table public.booking_security_deposits to service_role;

-- 4. Charges can be covered by the deposit -------------------------------------------------
alter table public.booking_charges
  add column if not exists deposit_applied numeric(12, 2) not null default 0;

alter table public.booking_charges drop constraint if exists booking_charges_deposit_applied_check;
alter table public.booking_charges add constraint booking_charges_deposit_applied_check
  check (deposit_applied >= 0 and deposit_applied <= amount);

alter table public.booking_charges drop constraint if exists booking_charges_method_check;
alter table public.booking_charges add constraint booking_charges_method_check
  check (payment_method is null or payment_method in ('cash', 'gcash', 'other', 'security_deposit'));

-- 5. Lifecycle email log --------------------------------------------------------------------
create table if not exists public.booking_email_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind text not null,
  status text not null,
  recipient text,
  failure_reason text,
  triggered_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint booking_email_events_kind_check
    check (kind in ('ready_for_pickup', 'picked_up', 'return_reminder', 'returned')),
  constraint booking_email_events_status_check check (status in ('sent', 'failed'))
);

create index if not exists booking_email_events_booking_idx
  on public.booking_email_events (booking_id, created_at desc);

alter table public.booking_email_events enable row level security;

drop policy if exists booking_email_events_admin_read on public.booking_email_events;
create policy booking_email_events_admin_read
on public.booking_email_events for select to authenticated
using ((select private.is_admin()));

revoke all on table public.booking_email_events from anon, authenticated;
grant select on table public.booking_email_events to authenticated;
grant all on table public.booking_email_events to service_role;

-- 6. Release guard: balance (unchanged) + security deposit (NEW) ----------------------------
create or replace function private.enforce_booking_payment_before_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total numeric := 0;
  v_paid numeric := 0;
begin
  if new.status = 'released' and old.status is distinct from new.status then
    if not coalesce(new.pay_later_allowed, false) then
      select coalesce(bt.total_amount, 0)
        into v_total
      from public.booking_totals bt
      where bt.booking_id = new.id;

      select coalesce(sum(bps.declared_amount), 0)
        into v_paid
      from public.booking_payment_submissions bps
      where bps.booking_id = new.id
        and bps.status = 'verified';

      if v_paid < v_total - 0.01 then
        raise exception 'BALANCE_PAYMENT_REQUIRED';
      end if;
    end if;

    -- NEW: the refundable deposit is always required before release (no pay-later bypass).
    if private.security_deposit_required(new.id) > 0 and not exists (
      select 1 from public.booking_security_deposits d
      where d.booking_id = new.id and d.status = 'held'
    ) then
      raise exception 'SECURITY_DEPOSIT_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;

-- 7. Record the deposit (full required amount, before release) ------------------------------
create or replace function public.admin_record_security_deposit(
  p_booking_id uuid,
  p_method text,
  p_reference text default null,
  p_collected_at timestamptz default now()
)
returns public.booking_security_deposits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_required numeric;
  v_reference text := nullif(trim(coalesce(p_reference, '')), '');
  v_deposit public.booking_security_deposits;
begin
  v_booking := private.fulfillment_lock_booking(p_booking_id);
  if v_booking.status not in ('confirmed', 'ready_for_release') then
    raise exception 'DEPOSIT_NOT_ALLOWED';
  end if;
  if exists (select 1 from public.booking_security_deposits where booking_id = p_booking_id) then
    raise exception 'DEPOSIT_ALREADY_RECORDED';
  end if;
  v_required := private.security_deposit_required(p_booking_id);
  if v_required <= 0 then
    raise exception 'DEPOSIT_NOT_REQUIRED';
  end if;
  if p_method is null or p_method not in ('cash', 'gcash', 'other') then
    raise exception 'INVALID_METHOD';
  end if;
  if p_collected_at is null or p_collected_at > now() + interval '5 minutes' then
    raise exception 'INVALID_DATE';
  end if;
  if v_reference is not null and length(v_reference) > 120 then
    raise exception 'INVALID_REFERENCE';
  end if;

  insert into public.booking_security_deposits (
    booking_id, required_amount, status, collected_amount, collected_method,
    collected_reference, collected_at, collected_by
  ) values (
    p_booking_id, v_required, 'held', v_required, p_method,
    v_reference, p_collected_at, auth.uid()
  )
  returning * into v_deposit;

  perform private.log_audit_event(
    'booking.deposit_collected', 'booking', p_booking_id::text, p_booking_id,
    null::jsonb, jsonb_build_object('amount', v_required, 'method', p_method),
    jsonb_build_object('reference', v_reference), 'admin'
  );
  return v_deposit;
end;
$$;

-- 8. Resolve the deposit after inspection: cover unpaid charges oldest first, refund the rest -
create or replace function public.admin_resolve_security_deposit(
  p_booking_id uuid,
  p_refund_method text default null,
  p_refund_reference text default null,
  p_note text default null
)
returns public.booking_security_deposits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_record public.booking_fulfillment_records;
  v_deposit public.booking_security_deposits;
  v_charge public.booking_charges;
  v_remaining numeric(12, 2);
  v_apply numeric(12, 2);
  v_deducted numeric(12, 2);
  v_status text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_reference text := nullif(trim(coalesce(p_refund_reference, '')), '');
begin
  v_booking := private.fulfillment_lock_booking(p_booking_id);
  if v_booking.status <> 'released' then
    raise exception 'DEPOSIT_RESOLVE_NOT_READY';
  end if;
  select * into v_record from public.booking_fulfillment_records where booking_id = p_booking_id;
  if v_record.booking_id is null or not v_record.returned or v_record.item_condition is null then
    raise exception 'DEPOSIT_RESOLVE_NOT_READY';
  end if;
  select * into v_deposit from public.booking_security_deposits
  where booking_id = p_booking_id for update;
  if v_deposit.booking_id is null then
    raise exception 'DEPOSIT_NOT_FOUND';
  end if;
  if v_deposit.status <> 'held' then
    raise exception 'DEPOSIT_ALREADY_RESOLVED';
  end if;
  if v_reference is not null and length(v_reference) > 120 then
    raise exception 'INVALID_REFERENCE';
  end if;

  v_remaining := v_deposit.collected_amount;
  for v_charge in
    select * from public.booking_charges
    where booking_id = p_booking_id and voided_at is null and payment_status = 'unpaid'
    order by created_at, id
    for update
  loop
    exit when v_remaining <= 0;
    v_apply := least(v_remaining, v_charge.amount - v_charge.deposit_applied);
    continue when v_apply <= 0;
    -- SET expressions read the old row, so deposit_applied here is the value before this update.
    update public.booking_charges
    set deposit_applied = deposit_applied + v_apply,
        payment_status = case when deposit_applied + v_apply >= amount then 'paid' else payment_status end,
        payment_method = case when deposit_applied + v_apply >= amount then 'security_deposit' else payment_method end,
        paid_at = case when deposit_applied + v_apply >= amount then now() else paid_at end,
        paid_recorded_by = case when deposit_applied + v_apply >= amount then auth.uid() else paid_recorded_by end
    where id = v_charge.id;
    v_remaining := v_remaining - v_apply;
  end loop;

  v_deducted := v_deposit.collected_amount - v_remaining;
  if v_remaining > 0 and (p_refund_method is null or p_refund_method not in ('cash', 'gcash', 'other')) then
    raise exception 'REFUND_METHOD_REQUIRED';
  end if;
  v_status := case
    when v_deducted = 0 then 'refunded'
    when v_remaining = 0 then 'fully_deducted'
    else 'partially_deducted'
  end;

  update public.booking_security_deposits
  set status = v_status,
      deducted_amount = v_deducted,
      refunded_amount = v_remaining,
      refund_method = case when v_remaining > 0 then p_refund_method end,
      refund_reference = case when v_remaining > 0 then v_reference end,
      refunded_at = case when v_remaining > 0 then now() end,
      resolution_note = v_note,
      resolved_by = auth.uid(),
      resolved_at = now(),
      updated_at = now()
  where booking_id = p_booking_id
  returning * into v_deposit;

  perform private.log_audit_event(
    'booking.deposit_resolved', 'booking', p_booking_id::text, p_booking_id,
    jsonb_build_object('status', 'held'),
    jsonb_build_object('status', v_status, 'deducted', v_deducted, 'refunded', v_remaining),
    jsonb_build_object('note', v_note), 'admin'
  );
  return v_deposit;
end;
$$;

-- 9. Void: same as Task 3 plus the deposit rule -----------------------------------------------
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
  if v_charge.deposit_applied > 0 then -- NEW
    raise exception 'CHARGE_COVERED_BY_DEPOSIT';
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

-- 10. Complete Rental: same as Task 3 plus "a Held deposit must be resolved" ----------------------
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

  -- NEW: a Held deposit must be refunded or deducted first. No row = released before the policy.
  if exists (
    select 1 from public.booking_security_deposits d
    where d.booking_id = p_booking_id and d.status = 'held'
  ) then
    raise exception 'COMPLETION_BLOCKED';
  end if;

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

-- 11. Permissions ------------------------------------------------------------------------------
revoke all on function public.admin_record_security_deposit(uuid, text, text, timestamptz) from public, anon;
revoke all on function public.admin_resolve_security_deposit(uuid, text, text, text) from public, anon;
grant execute on function public.admin_record_security_deposit(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.admin_resolve_security_deposit(uuid, text, text, text) to authenticated;

commit;
```

- [ ] **Step 2: Cross-check.**
  - Diff the `booking_totals` body against `supabase/migrations/20260812070320_time_based_unit_availability.sql`. The only difference allowed is the removed `+ coalesce(sum(bi.quantity::numeric * bi.deposit_per_unit_snapshot), 0::numeric)` term inside `total_amount`. Column names, order and types must match, or `create or replace view` fails. If a later migration redefines the view, use that definition instead.
  - Confirm no booking-creation RPC computes an amount that includes the deposit: `grep -n "deposit" supabase/migrations/2026082*.sql supabase/migrations/202609*.sql`.
- [ ] **Step 3: Types.** In `database.types.ts`:
  - Add `booking_security_deposits` and `booking_email_events` table types (Row/Insert/Update/Relationships, same style as Task 3 Step 5).
  - Add `deposit_applied: number` to `booking_charges` Row (and optional in Insert/Update).
  - Add the `admin_record_security_deposit` / `admin_resolve_security_deposit` function types returning the `booking_security_deposits` row (same `SetofOptions` style as Task 3 Step 6).
- [ ] **Step 4:** `npx tsc --noEmit`. Expect PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: add security deposit and lifecycle email schema"`

---

### Task 16: Security deposit rules, types and data loading

**Files:**
- Create: `src/lib/securityDeposit.ts`, `scripts/testSecurityDeposit.ts`
- Modify: `src/types/fulfillment.ts`, `src/lib/rentalFulfillment.ts`, `scripts/testRentalFulfillment.ts`
- Modify: `src/lib/fulfillmentMappers.ts` (Task 4), the fulfillment data loader (Task 6 `src/services/fulfillmentService.ts`) and the server completion loader (Task 5 `src/lib/server/fulfillmentServer.ts`)
- Modify: `package.json` (add `scripts/testSecurityDeposit.ts` to `test:fulfillment`)

**Interfaces produced:**
- `securityDeposit.ts`:
  - `SECURITY_DEPOSIT_PER_DEVICE = 1000`
  - `securityDepositRequired(units: number): number` (1000 x max(0, floor(units)))
  - `SecurityDepositStatus = "not_paid" | "held" | "refunded" | "partially_deducted" | "fully_deducted"`
  - `SECURITY_DEPOSIT_STATUS_LABELS`: Not Paid / Held / Refunded / Partially Deducted / Fully Deducted
  - `planDepositResolution({ held, charges }): { allocations: { chargeId: string; applied: number }[]; deducted: number; refund: number; remainingOwed: number; status: Exclude<SecurityDepositStatus, "not_paid" | "held"> }`. Pure mirror of the SQL in Task 15 §8: unpaid, non-voided charges oldest first (by `createdAt`, then `id`); each applies `min(remaining, amount - depositApplied)`; `remainingOwed` = unpaid charge amounts minus `depositApplied` minus this allocation, never below 0.
- `types/fulfillment.ts`:
  - `BookingCharge` gains `depositApplied: number`. `paymentMethod?: ChargePaymentMethod | "security_deposit"`. Keep `ChargePaymentMethod` as the manual methods only, so the mark-paid select does not offer the deposit.
  - New `SecurityDeposit` interface (camelCase of the table).
  - `FulfillmentData` gains `deposit: SecurityDeposit | null`, `depositRequired: number` and `emailEvents: LifecycleEmailEvent[]`, where `LifecycleEmailEvent` = `{ id; kind: "ready_for_pickup" | "picked_up" | "return_reminder" | "returned"; status: "sent" | "failed"; recipient?; failureReason?; createdAt }`. `EMPTY_FULFILLMENT_DATA` gets `deposit: null, depositRequired: 0, emailEvents: []`.
- `rentalFulfillment.ts`:
  - `computeAmountOwed`: `unpaidCharges` sums `amount - depositApplied` over unpaid active charges.
  - `CompletionInput` gains `depositStatus: SecurityDepositStatus | "none"` (`"none"` = no row). When it is `"held"`, `getCompletionBlockers` adds `"Resolve the security deposit (refund or deduct) in Charges & Payments."`.
  - `FollowUpInput` gains `depositRequired: number` and `depositStatus`. When `status` is `confirmed` or `ready_for_release`, `depositRequired > 0` and `depositStatus === "none"`, add the item `{ kind: "security_deposit", title: "Collect the security deposit", detail: "PHP X refundable deposit is required before the item can be released." }` (use `formatPhp`). Add `"security_deposit"` to `FollowUpKind`.
  - `buildEmailHistory` accepts `emailEvents` and adds one entry per event, with the labels "Ready for pickup email", "Picked up email", "Return reminder email" and "Returned email".
  - `CHARGE_METHOD_LABELS` stays manual-only. Add `chargeMethodLabel(method)` returning "Security deposit" for `security_deposit`.

- [ ] **Step 1: Failing tests** (`scripts/testSecurityDeposit.ts`, `scripts/testRentalFulfillment.ts`):
  - `securityDepositRequired(3) === 3000`
  - `planDepositResolution`:
    - no charges: refund all, status `refunded`
    - charges 300 + 200 with held 1000: deducted 500, refund 500, `partially_deducted`
    - charges 700 + 600 with held 1000: first charge fully covered, second `applied` 300, refund 0, `remainingOwed` 300, `fully_deducted`
    - voided and paid charges are ignored
    - a charge with `depositApplied` 100 of 400 applies at most 300
  - `computeAmountOwed` subtracts `depositApplied`
  - `getCompletionBlockers` with `depositStatus: "held"` lists the deposit blocker; with `"none"` or `"refunded"` it does not
  - the follow-up item appears only in the right statuses
  - the new email history labels
  - Update existing tests that build `BookingCharge` literals: add `depositApplied: 0`.
- [ ] **Step 2:** `npm run test:fulfillment` should FAIL. **Step 3:** Implement. **Step 4:** It should PASS.
- [ ] **Step 5: Data loading.**
  - Map `deposit_applied` in the charge mapper. Add `mapSecurityDeposit` and `mapEmailEvent`.
  - In the client fulfillment loader, also select `booking_security_deposits` (maybeSingle) and `booking_email_events` (order `created_at desc`) for the booking. Compute `depositRequired` with `securityDepositRequired(sum of booking item quantities)`.
  - If a new table is missing (migration not applied), keep the existing `available: false` fallback behavior. Do not throw.
  - In the server completion loader, load the deposit row and pass `depositStatus` (`"none"` when there is no row).
- [ ] **Step 6: Callers.** Update every caller of `getCompletionBlockers`, `getFollowUpItems` and `buildEmailHistory` (Tasks 5, 11, 12) to pass the new fields. `npx tsc --noEmit` must PASS.
- [ ] **Step 7: Commit.** `git commit -m "feat: add security deposit rules and load deposit data"`

---

### Task 17: Separate the deposit from the rental price and fix customer wording

**Files (find each with the grep in Step 1; the list is what the audit found):**
- `src/lib/reservationPricing.ts`, `scripts/testCheckout.ts`
- `app/cart/CartView.tsx`, `app/checkout/CheckoutFlowClient.tsx`, `app/catalog/[id]/reserve/ReserveFlowClient.tsx`, `app/catalog/[id]/ProductDetailsClient.tsx`
- `components/booking-summary/BookingSummaryCard.tsx`, `app/account/bookings/[bookingId]/page.tsx`, `app/admin/bookings/[bookingId]/AdminBookingDetail.tsx` (the `depositAmount` prop only)
- `app/faq/page.tsx`, `app/terms/page.tsx`, `app/how-to-book/page.tsx`, `app/rental-requirements/page.tsx` (only if it mentions the deposit)
- `app/admin/catalog/AdminCatalogManager.tsx`
- `app/api/admin/bookings/[bookingId]/pdf/route.ts`, `src/lib/pdf/customerDocuments.ts`, `app/api/bookings/[bookingId]/documents/submit/route.ts`
- `src/lib/bookingApprovalEmailDetails.ts`

- [ ] **Step 1: Inventory.** Run `grep -rn -i "non-refundable\|refundableDeposit\|deposit_total\|depositTotal\|summary.deposit\|totals.deposit" app components src --include=*.ts --include=*.tsx` and handle every hit below. Down-payment "non-refundable" wording in the Terms (reservation payments) is **correct and stays**. Change only security-deposit wording.
- [ ] **Step 2: Failing pricing tests.** Update `scripts/testCheckout.ts`: the pricing total no longer includes the deposit, and a new `securityDeposit` field equals `SECURITY_DEPOSIT_PER_DEVICE x units`. Run `npm run test:checkout`. Expect FAIL.
- [ ] **Step 3: Pricing.** In `reservationPricing.ts`, drop the deposit from the total. Expose `securityDeposit` (from `securityDepositRequired`) separately. Keep the old `deposit` field name only if callers need it; if kept, it must no longer be added into `total`. The server total (the view from Task 15) and the client total must now agree. Run `npm run test:checkout`. Expect PASS.
- [ ] **Step 4: Customer wording and display:**
  - Cart, checkout and reserve summaries: a separate line "Security deposit (refundable)", PHP X, with the note "Paid before pickup. Not included in the total. Returned after inspection."
  - Product page: "Security deposit (refundable): PHP 1,000 per device" (from the constant).
  - FAQ / Terms / How-to-book: say the PHP 1,000 per device security deposit is **refundable**, is collected before release, is returned after the return inspection, and that valid charges (late return, damage, missing parts) may be deducted from it. If charges are larger than the deposit, the customer pays the difference.
  - `BookingSummaryCard` callers pass the required security deposit, not `booking.refundableDeposit`. The label becomes "Security deposit (refundable)".
  - Customer booking page: show the deposit status for the booking. Read `booking_security_deposits` for the booking (the RLS owner policy allows it). "Not Paid" when there is no row, else the status label, plus refunded/deducted amounts when resolved. Show it only when the required deposit is above 0.
  - Approval email: add the remaining action `"Bring the PHP X refundable security deposit (PHP 1,000 per device) for pickup"` when the deposit is required. Amount from `securityDepositRequired`.
- [ ] **Step 5: Admin catalog.** Replace the "Non-refundable deposit (PHP)" input with a read-only line: "Security deposit: PHP 1,000 per device, refundable, collected before release (store policy)." Keep `refundableDeposit` in the form state and payload unchanged, so saving a product never alters the stored column. Update the change-log label ("Non-refundable Deposit") to "Legacy deposit field".
- [ ] **Step 6: PDFs.**
  - Admin booking PDF: replace the "Non-refundable deposit" row with "Security deposit (refundable)": the required amount and its current status.
  - Customer agreement PDF (`customerDocuments.ts`) and `documents/submit/route.ts`: new agreements pass the required security deposit and describe it as refundable after inspection, less valid charges.
  - Agreements that are already signed keep their stored snapshot. Do not regenerate them.
- [ ] **Step 7:** `npx tsc --noEmit && npm run lint && npm run test:checkout && npm run test:fulfillment`. Expect PASS. Then `grep -rn -i "non-refundable" app components src`: only down-payment/reservation wording may remain.
- [ ] **Step 8: Commit.** `git commit -m "feat: show refundable security deposit separately from the rental total"`

---

### Task 18: Lifecycle emails (Ready for Pickup, Picked Up, Return Reminder, Returned) + deposit in the completion email

**Files:**
- Create: `src/lib/lifecycleEmailContent.ts` (pure builders, using `src/lib/emailShell.ts` from Task 2); tests in `scripts/testFulfillmentEmails.ts`
- Create: `src/lib/server/lifecycleEmail.ts`
- Create: `app/api/admin/bookings/[bookingId]/lifecycle-email/route.ts`
- Modify: `app/api/admin/bookings/[bookingId]/route.ts` (PATCH), the Task 5 fulfillment route (`app/api/admin/bookings/[bookingId]/fulfillment/route.ts`)
- Modify: `src/lib/rentalCompletedEmailContent.ts` + `src/lib/server/rentalCompletedEmail.ts` (deposit section)
- Modify: `src/lib/rentalTiming.ts` (add `LATE_RETURN_FEE_PER_HOUR = 100` and `RETURN_REMINDER_LEAD_HOURS = 3`)
- Modify: the Customer Updates / email history UI from Tasks 10 and 12 (a Resend button for failed lifecycle emails)

**Behavior:**
- `buildLifecycleEmail(kind, details)` returns `{ subject, html, text }`. Details: customer name, booking reference, items, pickup date/time, return date/time (`bookings.pickup_at` / `return_at`, formatted with `formatManilaDateTime`), handover method, pickup location, remaining balance, security deposit required amount, deposit status, booking URL, and `isGuest`. Content per kind:
  - `ready_for_pickup`, subject `Rental {ref} is ready for pickup`: "Your rental is prepared." Pickup/delivery date, time and place. If a balance remains: "Remaining balance: PHP X, due before release." Security deposit: "PHP X refundable security deposit (PHP 1,000 per device), due before release." Bring your booking number and a valid ID.
  - `picked_up`, subject `You have your rental: {ref}`: return date/time. "Late returns are charged PHP 100 per hour." Deposit held: PHP X, returned after inspection.
  - `return_reminder`, subject `Reminder: rental {ref} is due back {time}`: the return time, the late fee note, same condition and all accessories.
  - `returned`, subject `We received your rental: {ref}`: return recorded at {time}. "We will inspect the item and settle your security deposit. You will get a final summary by email."
- Rental Completed email (Task 2 builder): add an optional `deposit` block: `{ held, deducted, refunded, refundMethodLabel?, remainingOwedPaid? }`. It shows "Security deposit: PHP X held. PHP Y deducted for charges. PHP Z refunded by {method}." Omit it when there is no deposit row. Tests cover: present, absent, fully deducted.
- `sendLifecycleEmail({ bookingId, kind, origin, triggeredBy }): Promise<{ sent: boolean; reason?: string }>` (server-only, never throws):
  1. Load the booking and items with the service-role client.
  2. Resolve the recipient with Task 4's `bookingRecipient`.
  3. Build the email and send it via Task 4's `emailTransport`, with idempotency key `lifecycle-{kind}-{bookingId}-{Date.now()}` (each explicit send is a real send; callers decide when to send).
  4. Insert a `booking_email_events` row (`sent` or `failed`, with a short `failure_reason` code, never provider text). If the table is missing, log and still return the send result.
- **Hooks** (all after the status change is saved, awaited, and their outcome returned to the client the same way the approval email is):
  - PATCH route: `ready_for_release` sends `ready_for_pickup`; `released` sends `picked_up`. Extend `isEmailBookingStatus` handling so the response reports `{ required: true, sent }` for these, and the admin toast works unchanged.
  - Fulfillment route, pickup action: send `picked_up` only when the booking was `ready_for_release` before the call (read the status first).
  - Fulfillment route, return action: send `returned` only when `record.returned` was false before the call.
- `POST /api/admin/bookings/:id/lifecycle-email` with body `{ kind }`: `requireActiveAdmin`, `enforceRateLimit(request, "admin-lifecycle-email", 10, 60_000)`. Allowed kinds and statuses:
  - `ready_for_pickup`: `ready_for_release` or `released`
  - `picked_up` and `return_reminder`: `released`
  - `returned`: `released` or `returned`

  Respond 409 with a plain message otherwise. Returns `{ sent, emailedTo? }`.
- Email history shows each lifecycle event. A failed row gets **Resend**, which calls the route above.

- [ ] **Step 1:** Failing builder tests: each kind's subject, the balance line only when the balance is above 0, the deposit amount, the late-fee line on `picked_up` and `return_reminder`, guest wording, HTML escaping of the customer name, and the completion email deposit block (present, absent, fully deducted).
- [ ] **Step 2:** FAIL, then implement, then PASS (`npm run test:fulfillment`).
- [ ] **Step 3:** Server sender, hooks, route and UI Resend. `npx tsc --noEmit && npm run lint` must PASS.
- [ ] **Step 4: Commit.** `git commit -m "feat: send and record ready, picked up, reminder and returned emails"`

---

### Task 19: Security deposit admin UI and routes

**Files:**
- Create: `app/api/admin/bookings/[bookingId]/security-deposit/route.ts`
- Create: `components/admin/SecurityDepositPanel.tsx` (+ styles in the existing fulfillment CSS module, or a small module next to it)
- Modify: `src/services/fulfillmentService.ts` (client callers), `src/lib/fulfillmentApiHelpers.ts` (error map)
- Modify: the Pickup, Charges & Payments and Complete Rental panels (Tasks 8, 9 and 11), the follow-up strip (Task 12), and `components/admin/PaymentsReviewPanel.tsx` (old UI) so both views can record the deposit

**Behavior:**
- `POST .../security-deposit` (`requireActiveAdmin`, rate limit 20/min). Bodies:
  - `{ action: "collect", method: "cash" | "gcash" | "other", reference?: string, collectedAt?: ISO }` calls `admin_record_security_deposit`.
  - `{ action: "resolve", refundMethod?: ..., refundReference?: string, note?: string }` calls `admin_resolve_security_deposit`.

  Map every code from Task 15 to a plain message:
  - `DEPOSIT_NOT_ALLOWED`: "The deposit can be recorded once the booking is confirmed and before the item is released."
  - `DEPOSIT_ALREADY_RECORDED`: "The security deposit is already recorded."
  - `DEPOSIT_NOT_REQUIRED`: "This booking has no devices that need a deposit."
  - `DEPOSIT_RESOLVE_NOT_READY`: "Record the return and the item condition before settling the deposit."
  - `DEPOSIT_NOT_FOUND`: "No security deposit was recorded for this booking."
  - `DEPOSIT_ALREADY_RESOLVED`: "The security deposit is already settled."
  - `REFUND_METHOD_REQUIRED`: "Choose how the refund was given."
  - `INVALID_REFERENCE`: "The reference is too long."
  - `CHARGE_COVERED_BY_DEPOSIT` (on the void route): "This charge was covered by the security deposit and can't be voided."
  - `SECURITY_DEPOSIT_REQUIRED` (on the pickup route): "Record the security deposit before releasing the item."
- `SecurityDepositPanel` (context: required amount, deposit row, charges, status, `onChanged`):
  - **Not Paid:** the required amount (PHP 1,000 x devices), a method select (Cash/GCash/Other), an optional reference, and **Record deposit received**, with a confirmation popup. Enabled only in `confirmed` / `ready_for_release`. Before that, the text "Available once the booking is confirmed."
  - **Held:** "Held: PHP X (method, date)". Once return and condition are recorded, a **Settle deposit** section:
    - a live preview from `planDepositResolution`: deductions per charge, refund amount, and "Customer still owes PHP X" when charges exceed the deposit
    - the refund method select (required when the refund is above 0), an optional reference and a note
    - a confirmation popup that restates the numbers

    Before return and condition are recorded: "Settle the deposit after the return inspection."
  - **Resolved:** status label, deducted, refunded (method, date), and the note. Read-only.
- Rendered in Charges & Payments (new UI) above the extra charges. It is also rendered in the old Payment tab via `PaymentsReviewPanel`, so bookings still on the old view can collect the deposit before release. Collect only there; resolve is only in the new view.
- **Pickup tab:** when the deposit is required and not Held, disable **Mark as Picked Up** with "Record the PHP X security deposit before pickup." and a link to Charges & Payments (same pattern as the balance message). The old UI's "Released to Customer" card is disabled the same way (extend `blockedByBalance` into a `blockedByHandover` that covers both, and show both messages).
- **Charges list:** show "Covered by deposit: PHP X" on charges with `depositApplied > 0`. The Mark-paid form uses `amount - depositApplied` as the amount due. Hide **Void** when `depositApplied > 0`.
- **Complete Rental checklist:** a "Security deposit settled" item (hidden when there is no deposit row).
- **Follow-up strip:** the new `security_deposit` item links to Charges & Payments.

- [ ] **Step 1:** Route + error map (add unit cases for the new codes in the Task 5 helper tests). **Step 2:** Service callers. **Step 3:** Panel and integrations. **Step 4:** `npx tsc --noEmit && npm run lint && npm run test:fulfillment` must PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: collect and settle the security deposit in admin"`

---

### Task 20: Return reminder job

**Files:**
- Create: `app/api/jobs/return-reminders/route.ts`
- Create: `scripts/returnReminderWorker.mjs`
- Create: `src/lib/returnReminders.ts` (pure selection) + tests in `scripts/testRentalFulfillment.ts`
- Modify: `ecosystem.config.cjs`, `.env.example`, `ops/PRODUCTION.md`
- Modify: Return panel (Task 8), adding **Send return reminder now** (calls the Task 18 lifecycle-email route with `return_reminder`)

**Behavior:**
- `selectBookingsDueForReminder(bookings, now, leadHours)` (pure). Input rows `{ id, status, returnAt, returned, reminderSent }`. It returns ids where:
  - `status === "released"`
  - `!returned`
  - `!reminderSent`
  - `now < returnAt <= now + leadHours`

  Tests: inside the window, outside it, already returned, already reminded, and past due (not reminded; only upcoming returns are).
- Route `POST /api/jobs/return-reminders`:
  - Requires the header `Authorization: Bearer ${process.env.CRON_SECRET}`. Compare in constant time. If `CRON_SECRET` is unset, respond 503 and send nothing.
  - Uses the service-role client to load `released` bookings with `return_at` inside the window, their fulfillment record (`returned`), and any `sent` `return_reminder` event.
  - Selects with the pure function and sends at most 25 per run via `sendLifecycleEmail({ kind: "return_reminder", triggeredBy: null, origin: process.env.NEXT_PUBLIC_APP_URL })`.
  - Returns `{ checked, sent, failed }`. A failed send is retried on the next run because only `sent` events block it.
- `scripts/returnReminderWorker.mjs`: plain Node, no dependencies. Every 15 minutes (and once at start, after a 60-second delay), POST to `${REMINDER_JOB_URL ?? "http://127.0.0.1:3000"}/api/jobs/return-reminders` with the bearer secret. It logs one line per run and never exits on failure.
- `ecosystem.config.cjs`: add a second app `{ name: "maddy-cassy-return-reminders", script: "scripts/returnReminderWorker.mjs", cwd: __dirname, instances: 1, exec_mode: "fork", autorestart: true, node_args: "--env-file=.env" }`. Leave the first app unchanged.
- `.env.example`: add `CRON_SECRET=` with a comment ("long random string; protects the return reminder job"). `ops/PRODUCTION.md`: one short section on the worker and `CRON_SECRET`.

- [ ] **Step 1:** Failing selection tests, then implement, then PASS. **Step 2:** Route, worker, config, docs, button. **Step 3:** `npx tsc --noEmit && npm run lint && npm run test:fulfillment` must PASS.
- [ ] **Step 4: Commit.** `git commit -m "feat: send return reminders from a scheduled job"`

---

## Task 14 additions (run with the original Task 14)

- `npm run verify` must pass.
- Apply **both** migrations in order (`20260921120000`, then `20260925120000`), only after the user says go. Afterwards, read-only checks:
  - `booking_totals.total_amount` is unchanged for every existing booking. Compare against a snapshot taken right before applying; all `deposit_total` are 0, so there should be no difference.
  - The new tables and functions exist.
- Manual pass on one test booking through every step of spec §11.1, including:
  - release blocked without the deposit
  - resolving with no charges (Refunded)
  - resolving with charges below and above the deposit
  - Complete Rental blocked while the deposit is Held
  - each lifecycle email recorded in Email History, and Resend on a failed one
  - the reminder job with and without `CRON_SECRET`
- Set `CRON_SECRET` on the server and start the worker (`pm2 start ecosystem.config.cjs`). This is the user's step. Explain it at handoff.
