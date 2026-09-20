# Automated Booking Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver every customer-visible reservation event through the existing Resend integration using a transactional Supabase outbox, automatic retries, deduplication, durable logs, and scheduled reminders.

**Architecture:** PostgreSQL triggers enqueue immutable semantic events in the same transaction as booking changes. A protected Next.js batch processor atomically claims due events, loads authoritative booking context, renders event-specific HTML/text, sends through Resend with the event key as its idempotency key, and records the outcome. A PM2 sidecar invokes the processor every minute and the processor also creates due five-hour/24-hour reminders.

**Tech Stack:** Next.js 16 route handlers, TypeScript 5, Node test runner through `tsx`, Supabase/PostgreSQL migrations and RPCs, Resend HTTP API, PM2.

**Spec:** `docs/superpowers/specs/2026-09-21-booking-email-notifications-design.md`

## Global Constraints

- Use the existing `RESEND_API_KEY`, `BOOKING_EMAIL_FROM`, and optional `BOOKING_EMAIL_REPLY_TO`; do not add another mail provider.
- Send only after the corresponding database transaction commits.
- Use the customer email associated with the booking and keep guest-booking contact handling working.
- Every email includes customer name, booking reference, all items and quantities, relevant status, applicable Manila date/time, and an explicit next action.
- Rejected payments/documents include the persisted reason and corrected-submission instructions.
- One-day rentals receive handover and return reminders five hours beforehand; longer rentals receive them 24 hours beforehand.
- Do not change booking, payment, document, inventory, agreement, cancellation, receipt-email, or admin authorization rules.
- Do not enqueue email for admin notes, reviewer identity, audit records, inventory bookkeeping, or timestamp-only/no-op writes.
- Preserve all pre-existing uncommitted work. Stage and commit only task-owned paths; inspect diffs before every commit.
- New exposed tables use RLS. Privileged functions use a fixed empty `search_path`, revoke `PUBLIC`/`anon`/`authenticated`, and grant only `service_role` where appropriate.
- Automated tests must never send live email.

## Review Focus

- Resend accepts a request but the worker loses the response: retrying must reuse the same provider idempotency key and result in at most one delivered message.
- Several rows change in one document or booking-edit transaction: the customer must receive one semantic email, not one per row.
- A booking enters the reminder window late or its schedule changes: queue one current reminder, never an obsolete or post-event reminder.
- A customer email is missing/invalid or changes after enqueue: resolve the booking-associated address at delivery, permanently log invalid recipients, and record the actual attempted recipient.
- Two PM2/HTTP processor calls overlap: atomic claiming must prevent both calls from processing the same row.

---

### Task 1: Notification domain model, reminder rules, and event content

**Files:**
- Create: `src/lib/bookingEmailNotifications.ts`
- Replace: `src/lib/bookingStatusEmailContent.ts`
- Create: `scripts/testEmailNotifications.ts`
- Modify: `scripts/testBookingManagement.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `BOOKING_EMAIL_NOTIFICATION_TYPES`, `BookingEmailNotificationType`, `BookingEmailEventPayload`, `calculateReminderLeadMs(dayCount)`, `buildBookingNotificationEmail(details)`.
- Consumes: existing `bookingTrackingPath`; no server environment or database access.

- [ ] **Step 1: Add the failing domain tests**

Create `scripts/testEmailNotifications.ts` with literal expectations for all customer-visible behaviors. The first cases must include:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBookingNotificationEmail,
  calculateReminderLeadMs,
  type BookingNotificationEmailDetails,
} from "../src/lib/bookingEmailNotifications";

const base: BookingNotificationEmailDetails = {
  type: "payment_rejected",
  bookingId: "booking-id",
  bookingReference: "BK-TEST-100",
  customerName: "Andrei <Test>",
  customerEmail: "andrei@example.com",
  items: [{ name: "iPhone 17 Pro Max", quantity: 2 }],
  statusLabel: "Payment rejected",
  occurredAt: "2026-09-21T04:00:00.000Z",
  bookingUrl: "https://rentals.example.com/account/bookings/booking-id",
  reason: "Screenshot is unreadable <script>",
};

test("one-day reminders lead by five hours and longer rentals lead by 24 hours", () => {
  assert.equal(calculateReminderLeadMs(1), 5 * 60 * 60 * 1000);
  assert.equal(calculateReminderLeadMs(2), 24 * 60 * 60 * 1000);
  assert.equal(calculateReminderLeadMs(10), 24 * 60 * 60 * 1000);
});

test("rejected payment email gives the saved reason and a correction action", () => {
  const email = buildBookingNotificationEmail(base);
  assert.match(email.subject, /payment proof needs correction/i);
  assert.match(email.text, /Screenshot is unreadable/);
  assert.match(email.text, /upload corrected payment proof/i);
  assert.match(email.text, /2 × iPhone 17 Pro Max/);
  assert.doesNotMatch(email.html, /<script>/);
});

test("completed email combines returned and completed without a second event", () => {
  const email = buildBookingNotificationEmail({ ...base, type: "booking_completed", reason: undefined });
  assert.match(email.subject, /booking complete/i);
  assert.match(email.text, /returned/i);
  assert.match(email.text, /complete/i);
  assert.match(email.text, /no action is required/i);
});
```

Add table-driven cases for all notification types from the spec. Each case asserts the booking reference, item quantities, status, action, and relevant time. Include registered and guest booking links, document/payment/cancellation reasons, pickup versus delivery wording, missing optional reason, multi-item content, and HTML escaping. Move the two old approval/completion assertions out of `testBookingManagement.ts` into this dedicated suite.

- [ ] **Step 2: Register and run the new test to verify RED**

Add `"test:email-notifications": "tsx --test scripts/testEmailNotifications.ts"` to `package.json` and include it in `verify`. Run:

```powershell
npm run test:email-notifications
```

Expected: FAIL because `src/lib/bookingEmailNotifications.ts` and its exports do not exist.

- [ ] **Step 3: Implement the minimal pure domain and template module**

Define the exact supported type union:

```ts
export const BOOKING_EMAIL_NOTIFICATION_TYPES = [
  "booking_submitted", "booking_approved", "booking_rejected",
  "reservation_confirmed", "ready_for_handover", "item_released",
  "booking_completed", "booking_cancelled", "booking_changed",
  "payment_proof_submitted", "payment_verified", "payment_rejected",
  "documents_submitted", "document_resubmitted",
  "document_correction_required", "documents_approved",
  "agreement_ready", "agreement_signed", "agreement_approved",
  "agreement_correction_required", "cancellation_requested",
  "cancellation_approved", "cancellation_rejected",
  "handover_reminder", "return_reminder",
] as const;
```

Implement `buildBookingNotificationEmail()` around a single escaped brand shell and an exhaustive `Record<BookingEmailNotificationType, EventCopyBuilder>`. `BookingNotificationEmailDetails` must accept item arrays rather than a single product name and must expose `reason`, `changedFields`, `amountPaid`, `remainingBalance`, `fulfillmentMethod`, `pickupAt`, `returnAt`, and `isGuest` as optional typed context. Every copy builder returns a status label and action sentence, including “No action is required” for informational events.

Keep a compatibility `buildBookingStatusEmail()` wrapper in `bookingStatusEmailContent.ts` for callers until Task 5 migrates them. It maps only `approved` and `returned` to the new builder.

- [ ] **Step 4: Run the focused tests to verify GREEN**

```powershell
npm run test:email-notifications
npm run test:bookings
```

Expected: both PASS, with no live network calls.

- [ ] **Step 5: Commit only Task 1 files**

```powershell
git add -- src/lib/bookingEmailNotifications.ts src/lib/bookingStatusEmailContent.ts scripts/testEmailNotifications.ts scripts/testBookingManagement.ts
git add -p -- package.json
git diff --cached --check
git commit -m "feat: define booking email notification content"
```

---

### Task 2: Durable outbox schema, safe queue RPCs, and database tests

**Files:**
- Create via `supabase migration new automated_booking_email_notifications` and normalize to the reserved plan path: `supabase/migrations/20260921024954_automated_booking_email_notifications.sql`
- Create: `scripts/testEmailNotificationOutbox.sql`
- Modify: `src/lib/supabase/database.types.ts`

**Interfaces:**
- Produces: `public.booking_email_notifications`; service-role RPCs `claim_booking_email_notifications(p_limit, p_worker_id)`, `mark_booking_email_notification_sent(p_notification_id, p_recipient, p_provider_id)`, `reschedule_booking_email_notification(p_notification_id, p_error, p_next_attempt_at)`, `fail_booking_email_notification(p_notification_id, p_recipient, p_error)`, and `enqueue_due_booking_email_reminders(p_now)`.
- Produces privately: `private.enqueue_booking_email_notification(p_booking_id, p_notification_type, p_event_key, p_payload, p_available_at)`.

- [ ] **Step 1: Verify current Supabase behavior before authoring SQL**

Read `https://supabase.com/changelog.md`, follow any relevant breaking-change entry, and consult the current database-function/RLS documentation. Run `npx supabase --version` and discover migration/database commands with `npx supabase migration --help` and `npx supabase db --help`; do not guess CLI flags.

- [ ] **Step 2: Create the SQL regression test first**

Create `scripts/testEmailNotificationOutbox.sql` as a transaction that inserts isolated customer/booking fixtures, invokes the intended private enqueue helper twice with the same event key, and raises exceptions unless exactly one row exists. Add assertions that:

```sql
select private.enqueue_booking_email_notification(
  v_booking_id,
  'booking_approved',
  'booking:' || v_booking_id || ':approved:2026-09-21T04:00:00Z',
  '{"status":"approved"}'::jsonb,
  now()
);

-- Repeat the same call, then assert count(*) = 1.
-- Claim from two worker IDs, then assert the second claim returns no row.
-- Mark sent and assert status/recipient/provider_id/sent_at are persisted.
-- Reschedule a second row and assert attempts and next_attempt_at advance.
-- Roll back all fixtures at the end.
```

Also assert RLS is enabled, `anon`/`authenticated` cannot execute service functions, a stale `processing` claim becomes reclaimable after ten minutes, and the log columns required by the user are non-null when sent.

- [ ] **Step 3: Run the SQL test to verify RED**

Start/inspect the local Supabase environment using commands discovered in Step 1, then run the script with the supported local SQL command or `psql` fallback.

Expected: FAIL because the table and functions do not exist.

- [ ] **Step 4: Generate the migration with the CLI and implement the schema**

Run:

```powershell
npx supabase migration new automated_booking_email_notifications
```

Rename the generated file to `supabase/migrations/20260921024954_automated_booking_email_notifications.sql` if the CLI used a later timestamp, then create:

```sql
create table public.booking_email_notifications (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  booking_reference text not null,
  notification_type text not null,
  event_key text not null unique,
  recipient text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','processing','sent','retry_scheduled','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  provider_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Add due-work and booking-history indexes, enable RLS, and create no browser policies. `private.enqueue_booking_email_notification` reads the booking reference itself and performs `insert ... on conflict (event_key) do update set payload = existing.payload || excluded.payload` only while the existing row is unsent; a sent row is immutable.

Implement claiming with `for update skip locked`, changing selected due/stale rows to `processing`, incrementing `attempt_count`, and returning them in one statement. All service RPCs are `security definer set search_path = ''`, revoke execution from `PUBLIC`, `anon`, and `authenticated`, and grant only `service_role`.

- [ ] **Step 5: Implement reminder enqueueing in SQL**

`enqueue_due_booking_email_reminders(p_now)` calculates `rental_days` from the authoritative booking dates. It queues:

- handover when `pickup_at - (5 hours for one day, otherwise 24 hours) <= p_now < pickup_at` and status is `approved`, `confirmed`, or `ready_for_release`;
- return when `return_at - (5 hours for one day, otherwise 24 hours) <= p_now < return_at` and status is `released`.

Use keys `reminder:<booking-id>:handover:<pickup-at>` and `reminder:<booking-id>:return:<return-at>` so schedule changes create a new current reminder while the processor suppresses unsent obsolete reminder rows whose payload timestamp no longer matches the booking. Closed bookings are excluded.

- [ ] **Step 6: Update TypeScript database types without overwriting current work**

Patch only the new table and RPC entries into `src/lib/supabase/database.types.ts`. Do not regenerate over the file because it already contains uncommitted inventory/payment type changes. Use the exact generated row/insert/update shapes and RPC return fields.

- [ ] **Step 7: Run SQL tests, migration checks, and advisors**

Run the local SQL regression to GREEN, then use the CLI help-discovered commands to verify migration state. Run Supabase security/performance advisors when the connected project capability is available; otherwise record the exact production advisor command in Task 6 documentation.

- [ ] **Step 8: Commit only Task 2 files**

```powershell
git add -- supabase/migrations/20260921024954_automated_booking_email_notifications.sql scripts/testEmailNotificationOutbox.sql
git add -p -- src/lib/supabase/database.types.ts
git diff --cached --check
git commit -m "feat: add booking email notification outbox"
```

---

### Task 3: Transactional event-capture triggers

**Files:**
- Modify: `supabase/migrations/20260921024954_automated_booking_email_notifications.sql`
- Modify: `scripts/testEmailNotificationOutbox.sql`

**Interfaces:**
- Consumes: `private.enqueue_booking_email_notification(...)` from Task 2.
- Produces: triggers that enqueue the exact semantic types declared in Task 1 without route-handler mail calls.

- [ ] **Step 1: Add failing SQL cases for booking and cancellation events**

Test pending booking insertion; each customer-visible status transition; changes to `pickup_at`, `return_at`, fulfillment method/address, and booking items; a no-op update; an `admin_notes`-only update; cancellation request insertion and both decisions. Assert exact types and one merged `booking_changed` event per booking transaction using `txid_current()` in the event key.

Expected RED: no event rows are created automatically.

- [ ] **Step 2: Add the booking and cancellation trigger functions**

Use `after insert or update` triggers. Status mappings are exhaustive and distinguish `cancellation_approved` from generic `booking_cancelled`: the cancellation-request decision event is canonical when the same transaction approves a request. `booking_changed` payload uses boolean JSON keys such as `{"schedule":true,"fulfillment":true,"items":true}` so `jsonb ||` merges multi-table changes.

- [ ] **Step 3: Add failing SQL cases for payment events**

Assert insert-at-`submitted`, update-to-`verified`, update-to-`rejected` with the saved rejection reason, and suppression of `under_review`, `void`, reviewer-only, and no-op updates.

- [ ] **Step 4: Add payment triggers and verify GREEN**

Trigger `booking_payment_submissions` after insert/status update. Event keys include payment submission ID and target status. Store declared amount, stage, reason/review notes, and source timestamp in payload.

- [ ] **Step 5: Add failing SQL cases for document and agreement events**

Assert one initial `documents_submitted` event when several requirement submissions are inserted in one transaction, per-requirement resubmission events, rejection with reason, one `documents_approved` event only when every required requirement is approved, customer signature, completed agreement, and rejected agreement. Assert no intermediate document-approval spam.

- [ ] **Step 6: Add document/agreement triggers and verify GREEN**

Use the transaction ID in initial-set event keys to collapse multi-row inserts. Use requirement/submission IDs and attempt numbers for correction/resubmission keys. Derive the final all-approved condition from `booking_requirements`. Trigger customer signatures from `agreement_signatures`; trigger ready/completed/rejected semantics from `booking_agreements`/current agreement version only where the existing workflow reaches those states.

- [ ] **Step 7: Run the complete SQL regression twice**

The first run verifies the event matrix. The second run verifies fixture cleanup and migration/test idempotency. Expected: both PASS with no duplicate event keys.

- [ ] **Step 8: Commit trigger work**

```powershell
git add -- supabase/migrations/20260921024954_automated_booking_email_notifications.sql scripts/testEmailNotificationOutbox.sql
git diff --cached --check
git commit -m "feat: capture customer-visible booking email events"
```

---

### Task 4: Resend transport and batch processor

**Files:**
- Create: `src/lib/resendTransport.ts`
- Replace: `src/lib/server/bookingStatusEmail.ts`
- Create: `src/lib/server/bookingEmailProcessor.ts`
- Create: `scripts/testBookingEmailProcessor.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `sendResendEmail(input, fetchImpl)`, `processBookingEmailBatch(dependencies, options)`, `resolveBookingNotificationDetails(admin, row, appUrl)`, and `getRetryDecision(result, attemptCount, now)`.
- Consumes: Task 1 template/types and Task 2 service-role RPCs.

- [ ] **Step 1: Write failing transport and processor tests**

Use in-memory repository fakes and an injected fake `fetch`, never a live provider. Assert:

```ts
test("provider request uses the outbox event key for idempotency", async () => {
  // Capture the outgoing RequestInit.
  // Assert headers["Idempotency-Key"] === row.event_key.
  // Assert to, subject, html, text, and booking/type tags.
});

test("accepted provider response marks the durable row sent", async () => {
  // Fake { ok: true, json: async () => ({ id: "resend-1" }) }.
  // Assert recipient/providerId/sentAt are written through the repository.
});

test("invalid recipient fails permanently without calling Resend", async () => {});
test("provider and network failures retry with bounded increasing delays", async () => {});
test("a reminder whose saved schedule no longer matches is suppressed", async () => {});
test("two claimed batches cannot deliver the same row", async () => {});
```

Add `test:email-processor` to `package.json` and `verify`.

- [ ] **Step 2: Run focused processor tests to verify RED**

```powershell
npm run test:email-processor
```

Expected: FAIL because the transport and processor modules do not exist.

- [ ] **Step 3: Extract a reusable Resend transport**

Move common Resend request handling out of the status-specific sender. The transport accepts explicit configuration rather than reading environment variables, validates recipients, reads both JSON and non-JSON failure bodies safely, returns `{ sent, providerId?, reason, detail? }`, and never logs secrets or content. Preserve the receipt sender API by leaving `receiptEmail.ts` behavior unchanged in this task.

- [ ] **Step 4: Implement booking detail resolution**

Load booking, profile, auth fallback, all booking items and quantities, verified payment total, fulfillment, and current requirement/agreement state. Prefer `profiles.contact_email`, retain the existing auth-user fallback, and use the guest tracking path when needed. Format all customer times in `Asia/Manila` and build the absolute URL from validated `NEXT_PUBLIC_APP_URL`.

- [ ] **Step 5: Implement batch processing and failure policy**

The processor first calls `enqueue_due_booking_email_reminders(now)`, then `claim_booking_email_notifications(limit, workerId)`. Process a small bounded batch (default 20) with controlled concurrency. Revalidate reminder timestamp/status before send. On success call the sent RPC. Treat missing/invalid email and malformed event payload as permanent; treat missing provider configuration and network/provider failures as retryable with delays of 1, 5, 15, 60, and 360 minutes, then permanent after the sixth failed attempt.

- [ ] **Step 6: Verify GREEN and existing email compatibility**

```powershell
npm run test:email-processor
npm run test:email-notifications
npm run test:bookings
npm run test:payments
```

Expected: PASS, no network access and no live email.

- [ ] **Step 7: Commit Task 4 files**

```powershell
git add -- src/lib/resendTransport.ts src/lib/server/bookingStatusEmail.ts src/lib/server/bookingEmailProcessor.ts scripts/testBookingEmailProcessor.ts
git add -p -- package.json
git diff --cached --check
git commit -m "feat: process queued booking emails through Resend"
```

---

### Task 5: Protected processor endpoint, PM2 worker, and legacy-send integration

**Files:**
- Create: `app/api/internal/booking-email-notifications/process/route.ts`
- Create: `scripts/bookingEmailWorker.mjs`
- Create: `scripts/testBookingEmailWorker.ts`
- Modify: `ecosystem.config.cjs`
- Modify: `app/api/admin/bookings/[bookingId]/route.ts`
- Modify: `app/api/admin/bookings/[bookingId]/confirmation-email/route.ts`
- Modify: `src/services/adminBookingService.ts`
- Modify carefully (currently has user changes): `app/admin/bookings/[bookingId]/AdminBookingDetail.tsx`
- Modify: `package.json`

**Interfaces:**
- Produces: authenticated `POST /api/internal/booking-email-notifications/process` returning batch counts.
- Produces: long-running PM2 worker invoking that route every 60 seconds.
- Consumes: `processBookingEmailBatch()` and `EMAIL_NOTIFICATION_WORKER_SECRET`.

- [ ] **Step 1: Write failing endpoint-auth and worker-loop tests**

Test constant-time secret comparison behavior for missing, wrong, and correct `Authorization: Bearer ...` values. Test that one worker tick posts to the configured internal URL, applies a request timeout, does not log the secret, and continues after a failed tick. Factor the testable tick/loop helpers so importing the script does not start an infinite loop.

- [ ] **Step 2: Run the tests to verify RED**

```powershell
npm run test:email-worker
```

Expected: FAIL because the route/helper and worker do not exist.

- [ ] **Step 3: Implement the protected processor route**

Require `EMAIL_NOTIFICATION_WORKER_SECRET` on both server and request, compare equal-length digests with `timingSafeEqual`, reject unauthorized requests with 401, and return 503 when required server configuration is absent. A successful call returns counts for claimed, sent, retried, permanently failed, and suppressed rows. Apply `force-dynamic`, `nodejs`, and `no-store`.

- [ ] **Step 4: Implement and configure the PM2 worker**

`scripts/bookingEmailWorker.mjs` waits for each request to finish before scheduling the next tick, uses `INTERNAL_APP_URL` defaulting to `http://127.0.0.1:3000`, applies a 45-second abort timeout, and handles SIGINT/SIGTERM cleanly. Add a second `ecosystem.config.cjs` app named `maddy-cassy-booking-email-worker`, one forked instance, with restart limits. Do not copy secrets into the config file; inherit them from the deployment environment.

- [ ] **Step 5: Remove direct automatic sends and preserve admin behavior**

Remove the synchronous `sendBookingStatusEmail()` branch from the admin booking status route; the committed status transition now creates the canonical outbox event. Return `customerEmail: { required, queued, sent: null, reason: null }` so the client can say the update was saved and the email queued.

Change the manual confirmation endpoint to locate the canonical `booking_approved` event. If already sent, return its recipient/timestamp without sending a duplicate. If failed/retry-scheduled, safely make the same row due and invoke one processor batch. Keep the existing admin control available as a retry/status action, preserving functionality without creating a second event key.

Patch the admin service/component copy from “emailed automatically” to “customer email queued” and show a delivery error only when the queue operation itself fails. Carefully retain the component's current uncommitted UI changes.

- [ ] **Step 6: Verify endpoint, worker, and admin behavior GREEN**

```powershell
npm run test:email-worker
npm run test:email-processor
npm run test:bookings
npx tsc --noEmit
```

Expected: PASS. Inspect the admin component diff to confirm no unrelated UI is reverted.

- [ ] **Step 7: Commit Task 5 paths only**

```powershell
git add -- app/api/internal/booking-email-notifications/process/route.ts scripts/bookingEmailWorker.mjs scripts/testBookingEmailWorker.ts ecosystem.config.cjs app/api/admin/bookings/[bookingId]/route.ts app/api/admin/bookings/[bookingId]/confirmation-email/route.ts src/services/adminBookingService.ts
git add -p -- app/admin/bookings/[bookingId]/AdminBookingDetail.tsx package.json
git diff --cached --check
git commit -m "feat: automate booking email delivery"
```

---

### Task 6: Configuration, deployment guidance, and end-to-end verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `ops/PRODUCTION.md`
- Modify: `app/api/health/route.ts`

**Interfaces:**
- Documents: `EMAIL_NOTIFICATION_WORKER_SECRET`, optional `INTERNAL_APP_URL`, PM2 lifecycle, migration/advisor checks, and notification-log diagnostics.
- Extends: health response with non-secret booleans for mail/worker configuration.

- [ ] **Step 1: Add configuration assertions to the worker tests**

Assert missing worker secret prevents processing, missing Resend configuration is reported as degraded configuration, and health output never contains secret values.

- [ ] **Step 2: Run the focused tests to verify RED**

Expected: the health/config assertions fail before the health route is extended.

- [ ] **Step 3: Document and expose safe configuration health**

Add these names to `.env.example` with server-only comments:

```dotenv
EMAIL_NOTIFICATION_WORKER_SECRET=
INTERNAL_APP_URL=http://127.0.0.1:3000
```

Document generating a high-entropy secret, applying the migration, running Supabase advisors, starting/restarting both PM2 processes, checking `pm2 logs maddy-cassy-booking-email-worker`, and querying failed log rows without exposing payload secrets. Update README event coverage and reminder timing. Health output may report only booleans such as `bookingEmailConfigured` and `bookingEmailWorkerConfigured`.

- [ ] **Step 4: Run focused and full verification**

```powershell
npm run test:email-notifications
npm run test:email-processor
npm run test:email-worker
npm run verify
```

Expected: all tests, lint, type-check, and production build PASS. If an unrelated pre-existing test fails, record its exact name and output; do not conceal it or rewrite unrelated functionality.

- [ ] **Step 5: Perform database and deployment-shape verification**

Apply the migration to the local Supabase instance, run `scripts/testEmailNotificationOutbox.sql`, and confirm the second PM2 app parses with:

```powershell
node -e "const c=require('./ecosystem.config.cjs'); if(c.apps.length!==2) process.exit(1)"
```

Start the application with test configuration, call the protected endpoint once with the correct secret, and verify an isolated queued fixture advances to the expected logged result using a fake/test Resend boundary. Do not send to a real customer from automated verification.

- [ ] **Step 6: Review the full patch for scope and security**

Inspect `git diff` and verify: no secret values, no browser import of service-role code, RLS enabled, privileged grants restricted, no direct email before commit, reasons escaped, all event types covered, no edits to unrelated inventory/payment logic, and all pre-existing user modifications preserved.

- [ ] **Step 7: Commit documentation and health changes**

```powershell
git add -- .env.example README.md ops/PRODUCTION.md app/api/health/route.ts
git diff --cached --check
git commit -m "docs: configure booking email automation"
```

- [ ] **Step 8: Final evidence summary**

Report migration filename, commits, notification matrix, full verification output, any advisor findings, and the exact production steps still requiring the operator's deployment credentials. Do not claim that production email is live until the migration, secrets, PM2 worker, and Resend domain are actually deployed and verified.
