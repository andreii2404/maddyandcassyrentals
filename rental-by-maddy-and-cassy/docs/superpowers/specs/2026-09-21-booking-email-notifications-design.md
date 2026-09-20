# Automated Booking Email Notifications Design

## Purpose

Build a reliable transactional email system that keeps a customer informed about important reservation changes without changing the behavior of existing booking, payment, document, inventory, or administration workflows. Messages must use the customer email associated with the booking, contain useful booking context and next steps, and be sent through the existing Resend configuration.

## Success Criteria

- A customer-visible event creates a durable email job only when the database transaction containing that event commits.
- Every message identifies the customer, booking reference, rented items, relevant status, applicable date/time, and the customer's next action.
- Rejected payments and documents include the saved rejection reason and instructions to submit a correction.
- Duplicate processing cannot produce duplicate event emails.
- Minor internal changes never create customer email jobs.
- Delivery attempts and outcomes are queryable by booking reference, recipient, notification type, status, and sent timestamp.
- Temporary delivery failures retry automatically without rolling back the business operation that created the event.
- Pickup/delivery and return reminders are scheduled five hours in advance for one-day rentals and 24 hours in advance for longer rentals.

## Existing System Context

The application is a Next.js application backed by Supabase. Booking mutations occur through a mixture of Next.js route handlers and PostgreSQL RPCs. Transactional booking email already uses Resend through `RESEND_API_KEY`, `BOOKING_EMAIL_FROM`, and the optional `BOOKING_EMAIL_REPLY_TO`. The production deployment runs as a standalone Node.js service under PM2 on a GoDaddy VPS.

The new subsystem will extend this sender rather than add another provider. Existing manual receipt email behavior remains unchanged.

## Architecture

### Durable outbox and notification log

Add `public.booking_email_notifications` as both the delivery outbox and the tracking log. Each row records:

- booking ID and immutable booking reference snapshot;
- notification type and deterministic event key;
- recipient resolved for the delivery attempt;
- event payload containing the relevant saved status, reason, and source timestamps;
- delivery status: `pending`, `processing`, `sent`, `retry_scheduled`, or `failed`;
- attempt count, next-attempt time, claim time, last error, and Resend provider ID;
- created, sent, and updated timestamps.

The event key has a unique constraint. It is derived from the source table/record, semantic notification type, and saved transition identity or version. It is also used as the Resend idempotency key. Database uniqueness prevents duplicate jobs; provider idempotency protects against the ambiguous case where Resend accepts a request but the application loses the response before marking the row sent.

The table is not customer- or browser-accessible. Row-level security is enabled with no public policies. Only service-role server code and narrowly granted database functions may read or mutate it.

### Transactional event capture

Narrow PostgreSQL triggers on the authoritative business tables classify saved changes and enqueue notification rows in the same transaction. A worker cannot observe an outbox row until its transaction commits, satisfying the requirement that email be sent only after the corresponding change is saved. If the business transaction rolls back, its notification row also rolls back.

Trigger logic compares old and new values and ignores no-op writes. It captures only facts needed to describe the event, including rejection/decision reasons as they existed at the transition. Internal fields such as admin notes, reviewer identity, audit entries, timestamps without semantic change, and inventory bookkeeping do not enqueue customer messages.

The trigger helper is kept in a non-exposed private schema, uses a fixed `search_path`, and is not executable by `anon` or `authenticated`. Any public claiming function is callable only by `service_role`.

### Delivery processor

A protected Next.js internal endpoint runs one bounded delivery batch. It uses the Supabase service-role client to atomically claim due rows, preventing concurrent workers from processing the same job. For each claimed event it:

1. Loads authoritative booking items, customer details, dates, fulfillment information, and totals needed by the template.
2. Resolves the booking-associated customer email from the profile/booking data, with the existing authenticated-user fallback where required by legacy records.
3. Builds event-specific HTML and plain-text content.
4. Sends through Resend with the event key as the provider idempotency key.
5. Marks the row `sent` with recipient, provider ID, and sent timestamp, or records a classified failure.

An invalid or missing recipient is a permanent `failed` result. Provider/network failures are rescheduled with bounded exponential delays. Delivery failure is recorded but does not alter or roll back the already-saved booking operation.

### Background scheduling

A small PM2-managed Node.js worker invokes the protected processor endpoint once per minute using a server-only shared secret. The existing application and the worker are declared in the production PM2 configuration. Multiple invocations are safe because claiming is atomic and event keys are unique.

Before claiming email work, the processor enqueues reminders that have entered their delivery window. Reminder event keys include the booking and reminder kind, so repeated scheduler runs do not duplicate them. Closed bookings do not receive future reminders.

For bookings whose stored day count is one, pickup/delivery and return reminders become due five hours before their respective scheduled times. For longer rentals, each reminder becomes due 24 hours beforehand. If a booking is created or changed after the normal lead time but before the event, the next scheduler run queues the reminder immediately. No reminder is sent after the scheduled event time.

## Notification Event Matrix

### Booking lifecycle

- `booking_submitted`: a new reservation reaches `pending`.
- `booking_approved`: status changes to `approved`.
- `booking_rejected`: status changes to `rejected`; include the saved reason.
- `reservation_confirmed`: status changes to `confirmed`.
- `ready_for_handover`: status changes to `ready_for_release`, using pickup or delivery wording.
- `item_released`: status changes to `released`, using handed-over wording where appropriate.
- `booking_completed`: status changes to `returned`. One email states that the item was returned and the booking is complete because the current schema represents both facts with the same terminal transition.
- `booking_cancelled`: status changes to `cancelled` outside an approved customer cancellation event.
- `booking_changed`: a persisted change affects customer-visible rental dates/times, fulfillment method or address, or rented items. The email summarizes changed fields. Internal-only booking updates are excluded.

### Payments

- `payment_proof_submitted`: a customer payment submission reaches `submitted`.
- `payment_verified`: a submitted payment reaches `verified`; include amount and remaining balance when available.
- `payment_rejected`: a submitted payment reaches `rejected`; include the saved rejection reason and instruct the customer to upload corrected payment proof. This single email also fulfills the payment re-upload-required case and avoids duplicate messages for one transition.

### Verification documents

- `documents_submitted`: the initial required document set is successfully recorded.
- `document_resubmitted`: a replacement document is successfully recorded.
- `document_correction_required`: the latest submission for a requirement is rejected; include the document label, saved reason, and resubmission instructions.
- `documents_approved`: all required booking documents become approved. Intermediate individual approvals do not create email, preventing approval-email spam while review is incomplete.

### Agreement

- `agreement_ready`: an agreement enters a state where customer action is required.
- `agreement_signed`: the customer's signature is successfully persisted.
- `agreement_approved`: the business countersignature is persisted and the agreement becomes `completed`.
- `agreement_correction_required`: an agreement reaches `rejected`; include the saved reason when the workflow records one.

Events are emitted only for transitions supported by the current workflow. Adding email capture must not invent a new agreement state or change who can approve or sign.

### Cancellation

- `cancellation_requested`: a customer cancellation request is persisted.
- `cancellation_approved`: the request decision becomes approved and the booking cancellation succeeds.
- `cancellation_rejected`: the request decision becomes rejected; include the administrator's saved response and explain that the booking remains active.

### Scheduled reminders

- `handover_reminder`: pickup or delivery reminder at the lead time defined above.
- `return_reminder`: upcoming return reminder at the lead time defined above.

## Email Content

All messages use one shared, escaped, mobile-friendly template shell consistent with the existing brand email. Each event definition supplies its subject, headline, status label, explanatory copy, and explicit next action.

Every message includes:

- customer name;
- booking reference;
- all rented item names and quantities;
- relevant status;
- relevant Manila date/time when applicable;
- a clear next step, including “no action is required” when informational;
- a safe booking-management link compatible with registered and guest booking access.

Dynamic values are HTML-escaped. Plain-text content contains the same operational information. Rejection reasons are displayed as saved but escaped and length-bounded by the existing workflow validation.

## Recipient Rules

The sender uses the customer email associated with the booking. The current profile contact email is preferred, followed by the booking-associated authenticated user email for legacy records. Existing guest checkout contact handling remains supported because guest bookings already store a booking-associated contact email. The resolved address is copied to the log row for tracking the actual attempt.

No email is sent when an address is absent or invalid. That event remains visible as a permanent failed log entry with a diagnostic reason.

## Observability and Operations

Application logs contain the notification row ID, booking ID, type, attempt number, and provider result but never API keys or private document contents. The durable table supplies operational history and debugging fields.

The processor endpoint requires a server-only `EMAIL_NOTIFICATION_WORKER_SECRET`. Deployment documentation will explain configuring that value and starting the PM2 worker. Health behavior will make a missing Resend or worker configuration visible rather than silently pretending delivery succeeded.

## Testing Strategy

Tests are written first and prove observable behavior:

- classification of each qualifying transition and suppression of internal/no-op changes;
- unique event-key behavior under repeated writes and repeated scheduler runs;
- atomic claim behavior for concurrent processors;
- permanent versus retryable failure classification and retry timing;
- recipient resolution and invalid-recipient handling;
- complete HTML/plain-text event content, item quantities, reasons, dates, and next steps;
- one-day five-hour reminder boundaries and longer-rental 24-hour boundaries;
- exclusion of reminders after handover/return time or after closure;
- route authentication for the worker endpoint;
- preservation of existing booking, payment, document, cancellation, and receipt-email tests.

No automated test sends a live email. The Resend network boundary is replaced with a deterministic fake while the real production sender path and request payload are exercised. A documented configuration check and a deliberately initiated non-test delivery provide deployment verification without placing live sends in the test suite.

## Scope and Non-Goals

- Do not change booking rules, status transition permissions, payment accounting, document review rules, agreement semantics, cancellation behavior, inventory allocation, or admin UI behavior.
- Do not replace existing in-app or web-push notifications.
- Do not introduce a second email provider or mock-only production path.
- Do not send customer email for admin notes, audit entries, internal inventory state, reviewer assignment, or other changes with no customer impact.
- Do not send two messages for one semantic transition merely because multiple database rows are updated to complete it.
- Existing receipt emails remain separate and retain their current manual behavior and attachment handling.

