# Returning Customer Reservation Prefill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse a signed-in customer’s current profile, latest valid booking emergency details, and approved unexpired emergency-contact document when opening a reservation for any rental device.

**Architecture:** Keep customer social links in `profiles`, keep emergency details in the existing `booking_emergency_contacts` row associated with the customer’s latest non-cancelled/non-rejected booking, and keep verified files in `customer_documents` linked to each new booking through the existing requirement-submission rows. Extend the existing verification-documents endpoint and reservation draft rather than adding customer or booking-history tables.

**Tech Stack:** Next.js App Router, React/TypeScript, Supabase/Postgres migrations, Zod, Node test runner via `tsx`.

**Spec:** User request in the active conversation.

## Global Constraints

- Retrieve data from the existing customer profile and/or latest valid booking data.
- Do not create duplicate customer information for each booking.
- Preserve existing verified-ID reuse and file-upload validation/security rules.
- Allow every pre-filled field to be edited before continuing.
- Do not copy rental dates, device, payment details, or booking status into the reusable customer data.

## Review Focus

- A customer with a valid approved emergency-contact ID must reuse the same `customer_documents` row without a new upload.
- An expired, inactive, or never-approved emergency-contact ID must not be reused and must require a fresh upload.
- A customer with no prior emergency data must still see the current empty form and validation.
- Existing local checkout progress and existing customer ID reuse must remain compatible after the draft shape changes.
- Emergency-contact Facebook must persist for future bookings while remaining editable and validated as a Facebook URL.

### Task 1: Persist emergency-contact Facebook in the existing booking contact record

**Files:**
- Create: `supabase/migrations/20261001170000_persist_emergency_contact_facebook.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `src/types/booking.ts`
- Modify: `src/services/bookingDetailService.ts`
- Modify: `app/api/bookings/[bookingId]/documents/submit/route.ts`

**Interfaces:**
- Consumes: the existing `booking_emergency_contacts` row and submitted `emergencyContact.facebookLink` payload.
- Produces: a nullable `facebook_url` column included in the generated local database types and booking-detail mapping.

- [ ] **Step 1: Write a failing test** asserting that the document-submit persistence payload includes the emergency contact Facebook URL and that booking-detail mapping exposes it.
- [ ] **Step 2: Run the focused test and verify it fails** because the existing row/type/mapping omits the field.
- [ ] **Step 3: Add the nullable `facebook_url` column** to `public.booking_emergency_contacts`, update local generated types, save it in the existing upsert, and map it to `EmergencyContact.facebookLink`.
- [ ] **Step 4: Run the focused test and verify it passes.**
- [ ] **Step 5: Run TypeScript validation for the touched files.**

### Task 2: Add cross-device reusable emergency-contact data to the existing lookup

**Files:**
- Modify: `app/api/account/verification-documents/route.ts`
- Modify: `src/types/reservationDraft.ts`
- Modify: `src/lib/reservationProgress.ts`

**Interfaces:**
- Consumes: authenticated user ID, `profiles`, `bookings`, `booking_emergency_contacts`, `customer_documents`, and approved requirement submissions.
- Produces: the existing endpoint response with an optional latest emergency contact and reusable `authorization_letter` document; `RequirementsDraft.reusedDocumentIds.emergencyId` identifies the same stored file.

- [ ] **Step 1: Write failing tests** for selecting the newest emergency contact from a valid customer booking, excluding cancelled/rejected bookings, and returning only active/unexpired/admin-approved emergency documents.
- [ ] **Step 2: Run the focused tests and verify they fail** because the endpoint only knows the three renter document types and returns no emergency contact.
- [ ] **Step 3: Extend the existing endpoint** to query the customer’s latest eligible booking contact and include `authorization_letter` in the existing approved/unexpired document filtering; extend draft persistence/restoration with `emergencyId` while retaining backward-compatible empty defaults.
- [ ] **Step 4: Run the focused tests and verify they pass.**
- [ ] **Step 5: Run the existing document and checkout test suites.**

### Task 3: Prefill and edit the reservation verification form

**Files:**
- Modify: `components/reservation/StepRequirements.tsx`
- Modify: `src/services/bookingSubmissionService.ts`
- Modify: `app/api/bookings/[bookingId]/documents/submit/route.ts`

**Interfaces:**
- Consumes: the extended verification-documents endpoint response and `RequirementsDraft`.
- Produces: editable Facebook/Instagram and emergency-contact fields; an automatically reused emergency ID rendered with the same replace/cancel interaction as existing verified IDs; submission metadata that either uploads or reuses exactly one emergency ID.

- [ ] **Step 1: Write failing tests** for one-time field prefill, user edits winning over fetched values, empty fallback, emergency-ID reuse, replacement upload, and validation when no valid ID is available.
- [ ] **Step 2: Run the focused tests and verify they fail** on the current form and submission service.
- [ ] **Step 3: Implement the minimal form changes** using the existing saved-document card/replacement pattern, fill only empty fields, and pass `reusedDocuments.emergencyId` through the existing secure submit endpoint.
- [ ] **Step 4: Update server validation** so emergency ID accepts exactly one fresh upload or approved reusable document, validates ownership/type/status/expiry/approval, and preserves all existing path checks and rate limits.
- [ ] **Step 5: Run focused form/submission tests and verify they pass.**

### Task 4: Full verification and regression review

**Files:**
- Modify only if verification exposes a defect in the touched files.

- [ ] **Step 1: Run `npm run lint`.**
- [ ] **Step 2: Run `tsc --noEmit`.**
- [ ] **Step 3: Run the full relevant suites: `npm run test:checkout`, `npm run test:documents`, and any new focused tests.**
- [ ] **Step 4: Run `npm run build`.**
- [ ] **Step 5: Review the diff for accidental booking-specific prefill, duplicate records, weakened authorization, or lost existing functionality.**

## Self-Review

The plan covers profile social-link prefill already present in checkout, latest-booking emergency details, verified emergency-ID reuse, editing and empty fallback, expiry/invalidation, draft compatibility, server-side ownership checks, and full regression verification. No new customer-information table is required.
