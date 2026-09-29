# Customer Service & Customer Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured support cases, documented service recovery, post-rental satisfaction feedback, and admin retention metrics to the Maddy & Cassy rental site, reusing the existing chat, notification, review, and loyalty systems rather than replacing them.

**Architecture:** Three new tables (`support_cases`, append-only `support_case_events`, `support_case_attachments`) plus `booking_feedback`, all written exclusively through `security definer` RPCs so status rules and history can never diverge. Guests need no account: a guest booking is already owned by an anonymous `auth.users` row, so one `customer_id` + RLS model covers guests and registered customers alike. Next.js route handlers wrap the RPCs; React Server Components render the screens; pure TypeScript modules hold every rule so the logic is unit-testable without a database.

**Tech Stack:** Next.js 15 App Router, React Server Components + client components, TypeScript, Supabase (Postgres + RLS + RPC + private Storage), Resend email, CSS Modules, `tsx --test` (node:test).

**Spec:** `docs/superpowers/specs/2026-09-30-customer-service-retention-design.md` — read it before Task 1. Every task argues from it.

## Global Constraints

- **Never publish a response-time promise.** `SUPPORT_RESPONSE_STANDARD` is `null` and stays `null`. No screen, email, or copy string may say "same-day", "within 24 hours", or any equivalent. Operating hours (`9:00 AM – 7:00 PM`) are operating hours, not a reply-time commitment.
- **No fabricated data anywhere.** No seed rows, sample cases, demo reviews, placeholder satisfaction scores, or invented statistics. Empty tables render explicit empty states.
- **Service recovery is documentation only.** `resolve_support_case` writes to `support_cases` and `support_case_events` and nothing else. It must never touch `bookings`, `booking_payment_submissions`, `promotions`, or any balance.
- **Internal admin notes must never reach a customer.** Excluded at the RLS level *and* in every API projection.
- **Case history is append-only.** No API, RPC, or grant may update or delete a `support_case_events` row.
- **Do not delete anything.** No file, table, column, route, or feature is removed. Existing flows keep working unchanged.
- **Do not apply migrations.** Write the `.sql` files; the human applies them. See Task 15.
- **Reuse, do not duplicate:** `emailTransport.sendEmail`, `public.notifications`, `public.admin_notifications`, `private.is_admin()`, `requireUser` / `requireActiveAdmin` / `enforceRateLimit` from `src/lib/server/requestSecurity.ts`, `createAdminClient()`, and `createSignedUrl` from `src/lib/supabase/storage.ts`.
- **Completed rental means `bookings.status = 'returned'`.** There is no `completed` enum value. Every metric and every eligibility check uses `'returned'`.
- **Loyalty rules are frozen.** Read `LOYALTY_REWARD_DISCOUNT`, `LOYALTY_REWARD_RENTAL_NUMBER`, `COMPLETED_RENTALS_BEFORE_REWARD` from `src/lib/promotions.ts`. Never hardcode ₱200 or 11.
- **Branding:** Poppins, the existing pink/cream palette, CSS Modules beside each component. Match the conventions in `app/account/bookings/[bookingId]/page.tsx` and `components/admin/`.
- **Never discard other people's work.** Do not run `git reset`, `git checkout --`, `git restore`, `git stash`, or `git clean` at any point. If you find unexpected uncommitted changes, leave them alone and report them. Read the current contents of every file before editing it — this branch receives merges from `origin/main` between tasks.
- **Migrations are written, never applied.** Do not run `supabase db push`, `supabase migration up`, or any `apply_migration` tool. The human applies them after explicit approval.
- **Verified against `origin/main` @ `b0e9c16` (2026-09-30).** The merge at `cd27c22` added an email-notification queue and a `send-booking-emails` edge function. That queue is **booking-status-specific** — its `email_type` union is a closed set (`booking_approved`, `booking_returned`, `booking_confirmation_contract`, `payment_rejected`, `payment_verified`). Support emails do **not** belong in it. Task 12 calls `sendEmail` from `src/lib/server/emailTransport.ts` directly, the same way `src/lib/server/customerUpdateEmail.ts` does. Do not route support mail through the queue or the edge function.
- **The `verify` chain already contains `test:date-selection`** (added by that merge). Insert the new test scripts without disturbing any existing entry.

## Review Focus

Five conditions the spec implies but that no obvious happy-path test would exercise. Each has a test assigned to the task that owns the code.

1. **A guest recovers their booking into a new anonymous session after filing a case.** Their `customer_id` changes; without the recovery amendment the case becomes unreachable and the customer is silently locked out of their own complaint. — Task 3.
2. **An admin reopens a resolved case.** The constraint forbids resolution fields on an `in_progress` row, so a reopen that does not clear them fails outright; and the original resolution must still be visible in history. — Task 4 and Task 2.
3. **A customer requests a case that is not theirs, by guessing an id.** Must be indistinguishable from a case that does not exist (404, not 403), or case ids become an existence oracle. — Task 6.
4. **A resolution of type `replacement` or `reschedule` arrives with an amount**, or a `refund` arrives without one. Both must be rejected rather than silently stored, or the admin record misrepresents what was agreed. — Task 4.
5. **Satisfaction metrics are read when `booking_feedback` is empty.** The average must render as "no responses yet", never `0`, `NaN`, or `0%` — a zero here reads as total dissatisfaction. — Task 13.

## File Structure

**Created — pure logic (no I/O, unit-tested):**
| File | Responsibility |
|---|---|
| `src/lib/support/supportChannels.ts` | The three official channels, the service window, the (null) response standard |
| `src/lib/support/supportCase.ts` | Categories, statuses, transition rules, resolution validation, follow-up-state derivation, customer-visible event projection |
| `src/lib/support/bookingFeedback.ts` | CSAT eligibility and rating validation |
| `src/lib/support/retentionMetrics.ts` | Repeat-customer, completed-rental, review, case, and satisfaction aggregation from plain rows |

**Created — server:**
| File | Responsibility |
|---|---|
| `src/lib/server/supportNotifications.ts` | Customer/admin notification rows + support emails |
| `app/api/support/cases/route.ts` | `GET` my cases, `POST` create a case |
| `app/api/support/cases/[caseId]/route.ts` | `GET` one case with its visible timeline |
| `app/api/support/cases/[caseId]/messages/route.ts` | `POST` a customer or admin reply |
| `app/api/support/cases/[caseId]/attachments/route.ts` | `POST` upload, `GET` signed URL for one attachment |
| `app/api/bookings/[bookingId]/feedback/route.ts` | `POST` a CSAT response |
| `app/api/admin/support/route.ts` | `GET` the admin case inbox |
| `app/api/admin/support/[caseId]/route.ts` | `GET` full case incl. internal notes; `PATCH` status; `POST` resolve |
| `app/api/admin/support/[caseId]/notes/route.ts` | `POST` an internal note |
| `app/api/admin/retention/route.ts` | `GET` retention + satisfaction metrics |

**Created — UI:**
`components/support/SupportHelpCallout.tsx`, `components/support/SupportCaseForm.tsx`, `components/support/SupportCaseTimeline.tsx`, `components/support/SupportStatusChip.tsx`, `components/support/BookingFeedbackPanel.tsx`, `app/account/support/page.tsx`, `app/account/support/[caseId]/page.tsx`, `app/admin/support/page.tsx` + `AdminSupportManager.tsx`, `app/admin/retention/page.tsx` + `AdminRetentionPanel.tsx` (each with its `.module.css`).

**Created — migrations (written, not applied):**
`supabase/migrations/20260930090000_support_cases_and_feedback.sql`, `supabase/migrations/20260930091000_recover_guest_support_cases.sql`.

**Created — tests:** `scripts/testSupportCases.ts`, `scripts/testRetentionMetrics.ts`.

**Modified:** `app/contact/page.tsx`, `components/navbar/Navbar.tsx`, `components/footer/SiteFooter.tsx`, `components/admin/AdminShell.tsx`, `app/account/bookings/[bookingId]/page.tsx`, `app/guest/bookings/[bookingId]/page.tsx`, `app/admin/reviews/AdminReviewsManager.tsx`, `app/api/admin/reviews/route.ts`, `src/lib/supabase/storage.ts`, `src/lib/server/rentalCompletedEmail.ts`, `package.json`.

---

### Task 1: Support channel single source of truth

**Files:**
- Create: `src/lib/support/supportChannels.ts`
- Create: `scripts/testSupportCases.ts`
- Modify: `app/contact/page.tsx`, `components/navbar/Navbar.tsx`, `components/footer/SiteFooter.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `SupportChannel`, `SUPPORT_CHANNELS: readonly SupportChannel[]`, `SERVICE_WINDOW: string`, `SUPPORT_RESPONSE_STANDARD: string | null`.

- [ ] **Step 1: Write the failing test**

Create `scripts/testSupportCases.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  SUPPORT_CHANNELS,
  SERVICE_WINDOW,
  SUPPORT_RESPONSE_STANDARD,
} from "../src/lib/support/supportChannels";

test("the three official channels are preserved exactly", () => {
  assert.deepEqual(
    SUPPORT_CHANNELS.map((channel) => channel.id),
    ["tiktok", "email", "facebook"],
  );
  const email = SUPPORT_CHANNELS.find((channel) => channel.id === "email");
  assert.equal(email?.value, "iosrentalbymaddycassy@gmail.com");
  assert.equal(email?.href, "mailto:iosrentalbymaddycassy@gmail.com");
  const tiktok = SUPPORT_CHANNELS.find((channel) => channel.id === "tiktok");
  assert.equal(tiktok?.href, "https://www.tiktok.com/@iosrental.maddycassy");
  const facebook = SUPPORT_CHANNELS.find((channel) => channel.id === "facebook");
  assert.equal(facebook?.href, "https://www.facebook.com/share/19bCnTQZum/");
});

test("no response-time standard is published", () => {
  // The business has not committed to a reply time. Publishing one would be a
  // promise the site cannot keep. Flipping this to a string is a business
  // decision, not an implementation detail.
  assert.equal(SUPPORT_RESPONSE_STANDARD, null);
});

test("the service window is the already-published appointment window", () => {
  assert.equal(SERVICE_WINDOW, "9:00 AM – 7:00 PM");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test scripts/testSupportCases.ts`
Expected: FAIL — `Cannot find module '../src/lib/support/supportChannels'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/support/supportChannels.ts`:

```ts
export interface SupportChannel {
  id: "tiktok" | "email" | "facebook";
  label: string;
  value: string;
  href: string;
  description: string;
}

/** The official support channels. Moved verbatim from app/contact/page.tsx. */
export const SUPPORT_CHANNELS: readonly SupportChannel[] = [
  {
    id: "tiktok",
    label: "TikTok",
    value: "@iosrental.maddycassy",
    href: "https://www.tiktok.com/@iosrental.maddycassy",
    description: "See rental updates, featured units, and announcements.",
  },
  {
    id: "email",
    label: "Email",
    value: "iosrentalbymaddycassy@gmail.com",
    href: "mailto:iosrentalbymaddycassy@gmail.com",
    description: "Send booking questions or rental-related concerns by email.",
  },
  {
    id: "facebook",
    label: "Facebook",
    value: "Rental by Maddy & Cassy",
    href: "https://www.facebook.com/share/19bCnTQZum/",
    description: "Message the rental team through their Facebook page.",
  },
] as const;

/**
 * The published pickup and delivery appointment window (app/terms/page.tsx).
 * These are operating hours, not a promise about how fast a reply arrives.
 */
export const SERVICE_WINDOW = "9:00 AM – 7:00 PM";

/**
 * Null until the business explicitly commits to a response-time standard.
 * Every surface renders a response-time line only when this is non-null, so no
 * screen can invent one. Setting it is a business decision.
 */
export const SUPPORT_RESPONSE_STANDARD: string | null = null;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test scripts/testSupportCases.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Point the three existing surfaces at the module**

In `app/contact/page.tsx`, delete the local `contactMethods` array and import `SUPPORT_CHANNELS`, `SERVICE_WINDOW`, `SUPPORT_RESPONSE_STANDARD`. Map over `SUPPORT_CHANNELS` in place of `contactMethods` (`method.label` → `channel.label`, and the button label check becomes `channel.id === "email"`). Below the subheading add:

```tsx
<p className={styles.serviceWindow}>
  Pickup and delivery appointments are scheduled between {SERVICE_WINDOW}.
</p>
{SUPPORT_RESPONSE_STANDARD ? (
  <p className={styles.responseStandard}>{SUPPORT_RESPONSE_STANDARD}</p>
) : null}
```

Add `.serviceWindow` and `.responseStandard` to `app/contact/contact.module.css`, matching the existing `.subheading` rule with a smaller size and the muted text colour already used in that file.

`components/navbar/Navbar.tsx` needs **no change here**: it carries only a `/contact` nav link (line 18), not the channel details. Leave it alone in this task.

`components/footer/SiteFooter.tsx` holds the three channels in a local array at lines 40–42, whose `href`/`label`/`value` already match `SUPPORT_CHANNELS` exactly:

```tsx
{ href: "https://www.tiktok.com/@iosrental.maddycassy", label: "TikTok", value: "@iosrental.maddycassy" },
{ href: "https://www.facebook.com/share/19bCnTQZum/", label: "Facebook", value: "Rental by Maddy & Cassy" },
{ href: "mailto:iosrentalbymaddycassy@gmail.com", label: "Email", value: "iosrentalbymaddycassy@gmail.com" },
```

Replace that array's contents with a mapping over `SUPPORT_CHANNELS` that produces the same `{ href, label, value }` shape, preserving the footer's existing order if it differs. Rendered output must be byte-identical. **Read the file first.** Do not change layout, classes, or any unrelated markup.

- [ ] **Step 6: Register the test script**

In `package.json`, add `"test:support": "tsx --test scripts/testSupportCases.ts"` to `scripts`, and insert `npm run test:support && ` into the `verify` chain immediately before `npm run build`.

- [ ] **Step 7: Verify nothing regressed**

Run: `npm run test:support && npx tsc --noEmit && npm run lint`
Expected: tests PASS, no type errors, no new lint errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/support/supportChannels.ts scripts/testSupportCases.ts app/contact/ components/navbar/Navbar.tsx components/footer/SiteFooter.tsx package.json
git commit -m "feat: single source of truth for support channels"
```

---

### Task 2: Support case schema, RLS, and RPCs

**Files:**
- Create: `supabase/migrations/20260930090000_support_cases_and_feedback.sql`

**Interfaces:**
- Consumes: existing `public.bookings`, `auth.users`, `private.is_admin()`.
- Produces: tables `public.support_cases`, `public.support_case_events`, `public.support_case_attachments`, `public.booking_feedback`; RPCs `public.create_support_case(text, text, text, uuid) returns table(case_id uuid, case_reference text)`, `public.add_support_case_message(uuid, text) returns uuid`, `public.add_support_case_note(uuid, text) returns uuid`, `public.update_support_case_status(uuid, text) returns void`, `public.resolve_support_case(uuid, text, text, numeric) returns void`, `public.submit_booking_feedback(uuid, smallint, text) returns void`.

This task writes SQL only. **Do not apply it.** Verification is a review against the spec's §5 and §6.

- [ ] **Step 1: Write the tables**

Create `supabase/migrations/20260930090000_support_cases_and_feedback.sql` starting with:

```sql
-- Structured customer support cases (complaints), their append-only history,
-- their attachments, and post-rental satisfaction feedback.
--
-- Guests are supported without accounts: a guest booking is already owned by an
-- anonymous auth.users row, so one customer_id column and one RLS predicate
-- cover guests and registered customers alike.

begin;

create table if not exists public.support_cases (
  id uuid primary key default gen_random_uuid(),
  case_reference text not null unique
    default ('SC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  customer_id uuid not null references auth.users(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  category text not null,
  subject text not null,
  status text not null default 'open',
  resolution_type text,
  resolution_amount numeric(10, 2),
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  closed_at timestamptz,
  first_admin_response_at timestamptz,
  last_customer_message_at timestamptz,
  last_admin_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_cases_category_check check (
    category in ('booking_issue', 'payment_issue', 'item_condition',
                 'delivery_pickup', 'account_access', 'other')
  ),
  constraint support_cases_status_check check (
    status in ('open', 'in_progress', 'resolved', 'closed')
  ),
  constraint support_cases_subject_check check (
    char_length(btrim(subject)) between 3 and 120
  ),
  constraint support_cases_resolution_type_check check (
    resolution_type is null
    or resolution_type in ('refund', 'replacement', 'credit', 'reschedule', 'other')
  ),
  -- A resolution cannot exist without an actor, a timestamp and a note, and an
  -- unresolved case cannot carry leftover resolution data.
  constraint support_cases_resolution_complete_check check (
    (status in ('open', 'in_progress')
      and resolution_type is null and resolution_note is null
      and resolution_amount is null and resolved_by is null and resolved_at is null)
    or (status in ('resolved', 'closed')
      and resolution_type is not null and resolved_by is not null
      and resolved_at is not null
      and char_length(btrim(coalesce(resolution_note, ''))) > 0)
  ),
  -- An amount is recorded for money outcomes only, and only as a positive figure.
  constraint support_cases_resolution_amount_check check (
    case
      when resolution_type in ('refund', 'credit')
        then resolution_amount is not null and resolution_amount > 0
      else resolution_amount is null
    end
  ),
  constraint support_cases_closed_check check ((status = 'closed') = (closed_at is not null))
);

comment on table public.support_cases is
  'Customer complaints and support requests. A resolution here is documentation of an admin decision; it never moves money or changes a booking.';

create index if not exists support_cases_customer_idx
  on public.support_cases (customer_id, created_at desc);
create index if not exists support_cases_status_idx
  on public.support_cases (status, created_at desc);
create index if not exists support_cases_booking_idx
  on public.support_cases (booking_id) where booking_id is not null;

create table if not exists public.support_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  actor_role text not null,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  body text,
  from_status text,
  to_status text,
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint support_case_events_actor_role_check check (
    actor_role in ('customer', 'admin', 'system')
  ),
  constraint support_case_events_type_check check (
    event_type in ('message', 'admin_note', 'status_change', 'resolution')
  ),
  constraint support_case_events_actor_check check ((actor_role = 'system') = (actor_id is null)),
  constraint support_case_events_body_check check (
    body is null or char_length(btrim(body)) between 1 and 2000
  ),
  constraint support_case_events_message_check check (
    event_type <> 'message'
    or (is_internal = false and char_length(btrim(coalesce(body, ''))) > 0)
  ),
  constraint support_case_events_note_check check (
    event_type <> 'admin_note'
    or (is_internal = true and actor_role = 'admin'
        and char_length(btrim(coalesce(body, ''))) > 0)
  ),
  constraint support_case_events_status_check check (
    event_type not in ('status_change', 'resolution') or to_status is not null
  )
);

comment on table public.support_case_events is
  'Append-only case history: customer messages, admin replies, internal notes, status changes and resolutions. Never updated, never deleted.';

create index if not exists support_case_events_case_idx
  on public.support_case_events (case_id, created_at, id);

create table if not exists public.support_case_attachments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  event_id uuid references public.support_case_events(id) on delete set null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists support_case_attachments_case_idx
  on public.support_case_attachments (case_id, created_at);

create table if not exists public.booking_feedback (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(btrim(comment)) between 1 and 1000),
  created_at timestamptz not null default now()
);

comment on table public.booking_feedback is
  'One private satisfaction response per completed booking. Insert-only: a satisfaction figure is never revised after the fact.';

create index if not exists booking_feedback_created_idx
  on public.booking_feedback (created_at desc);
```

- [ ] **Step 2: Make the history immutable**

Append:

```sql
-- History is append-only. UPDATE is blocked by trigger; DELETE is blocked by
-- withholding the grant rather than by trigger, so that deleting a customer
-- account still cascades cleanly through support_cases into its events.
create or replace function private.block_support_case_event_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'SUPPORT_CASE_HISTORY_IMMUTABLE';
end;
$$;

drop trigger if exists support_case_events_immutable on public.support_case_events;
create trigger support_case_events_immutable
before update on public.support_case_events
for each row execute function private.block_support_case_event_update();
```

- [ ] **Step 3: Write the RLS policies and grants**

Append:

```sql
alter table public.support_cases enable row level security;
alter table public.support_case_events enable row level security;
alter table public.support_case_attachments enable row level security;
alter table public.booking_feedback enable row level security;

drop policy if exists support_cases_read on public.support_cases;
create policy support_cases_read
on public.support_cases for select to authenticated
using (customer_id = (select auth.uid()) or (select private.is_admin()));

-- Internal notes are invisible to customers at the row level, so a bug in an
-- API projection alone cannot leak one.
drop policy if exists support_case_events_read on public.support_case_events;
create policy support_case_events_read
on public.support_case_events for select to authenticated
using (
  (select private.is_admin())
  or (
    is_internal = false
    and exists (
      select 1 from public.support_cases as parent
      where parent.id = support_case_events.case_id
        and parent.customer_id = (select auth.uid())
    )
  )
);

drop policy if exists support_case_attachments_read on public.support_case_attachments;
create policy support_case_attachments_read
on public.support_case_attachments for select to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1 from public.support_cases as parent
    where parent.id = support_case_attachments.case_id
      and parent.customer_id = (select auth.uid())
  )
);

drop policy if exists booking_feedback_read on public.booking_feedback;
create policy booking_feedback_read
on public.booking_feedback for select to authenticated
using (customer_id = (select auth.uid()) or (select private.is_admin()));

-- Every write goes through the RPCs below, so no table carries an
-- insert/update/delete grant for authenticated callers.
revoke all on table public.support_cases from anon, authenticated;
revoke all on table public.support_case_events from anon, authenticated;
revoke all on table public.support_case_attachments from anon, authenticated;
revoke all on table public.booking_feedback from anon, authenticated;

grant select on table public.support_cases to authenticated;
grant select on table public.support_case_events to authenticated;
grant select on table public.support_case_attachments to authenticated;
grant select on table public.booking_feedback to authenticated;

grant all on table public.support_cases to service_role;
grant all on table public.support_case_events to service_role;
grant all on table public.support_case_attachments to service_role;
grant all on table public.booking_feedback to service_role;
```

- [ ] **Step 4: Write the case-creation and message RPCs**

Append:

```sql
create or replace function public.create_support_case(
  p_category text,
  p_subject text,
  p_message text,
  p_booking_id uuid default null
)
returns table (case_id uuid, case_reference text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_case public.support_cases%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if char_length(btrim(coalesce(p_message, ''))) < 10 then
    raise exception 'SUPPORT_MESSAGE_TOO_SHORT';
  end if;

  -- A booking may only be attached by the customer who owns it. This is what
  -- lets a verified guest file a case without an account.
  if p_booking_id is not null and not exists (
    select 1 from public.bookings as owned
    where owned.id = p_booking_id and owned.customer_id = v_uid
  ) then
    raise exception 'SUPPORT_BOOKING_NOT_FOUND';
  end if;

  insert into public.support_cases (
    customer_id, booking_id, category, subject, last_customer_message_at
  )
  values (v_uid, p_booking_id, p_category, btrim(p_subject), now())
  returning * into v_case;

  insert into public.support_case_events (case_id, actor_role, actor_id, event_type, body)
  values (v_case.id, 'customer', v_uid, 'message', btrim(p_message));

  return query select v_case.id, v_case.case_reference;
end;
$$;

create or replace function public.add_support_case_message(p_case_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean := (select private.is_admin());
  v_case public.support_cases%rowtype;
  v_role text;
  v_event_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'SUPPORT_MESSAGE_REQUIRED';
  end if;

  select * into v_case from public.support_cases where id = p_case_id for update;
  if v_case.id is null then
    raise exception 'SUPPORT_CASE_NOT_FOUND';
  end if;

  if v_is_admin then
    v_role := 'admin';
  elsif v_case.customer_id = v_uid then
    v_role := 'customer';
  else
    -- Same error as a missing case: a case id must not reveal its own existence.
    raise exception 'SUPPORT_CASE_NOT_FOUND';
  end if;

  if v_case.status = 'closed' then
    raise exception 'SUPPORT_CASE_CLOSED';
  end if;

  insert into public.support_case_events (case_id, actor_role, actor_id, event_type, body)
  values (p_case_id, v_role, v_uid, 'message', btrim(p_body))
  returning id into v_event_id;

  if v_role = 'admin' then
    update public.support_cases
    set last_admin_message_at = now(),
        first_admin_response_at = coalesce(first_admin_response_at, now()),
        updated_at = now()
    where id = p_case_id;
  else
    update public.support_cases
    set last_customer_message_at = now(), updated_at = now()
    where id = p_case_id;
  end if;

  return v_event_id;
end;
$$;

create or replace function public.add_support_case_note(p_case_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_event_id uuid;
begin
  if v_uid is null or not (select private.is_admin()) then
    raise exception 'ADMIN_REQUIRED' using errcode = '28000';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'SUPPORT_NOTE_REQUIRED';
  end if;
  if not exists (select 1 from public.support_cases where id = p_case_id) then
    raise exception 'SUPPORT_CASE_NOT_FOUND';
  end if;

  insert into public.support_case_events (
    case_id, actor_role, actor_id, event_type, body, is_internal
  )
  values (p_case_id, 'admin', v_uid, 'admin_note', btrim(p_body), true)
  returning id into v_event_id;

  update public.support_cases set updated_at = now() where id = p_case_id;
  return v_event_id;
end;
$$;
```

- [ ] **Step 5: Write the status, resolution, and feedback RPCs**

Append:

```sql
create or replace function public.update_support_case_status(p_case_id uuid, p_to_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_case public.support_cases%rowtype;
begin
  if v_uid is null or not (select private.is_admin()) then
    raise exception 'ADMIN_REQUIRED' using errcode = '28000';
  end if;

  select * into v_case from public.support_cases where id = p_case_id for update;
  if v_case.id is null then
    raise exception 'SUPPORT_CASE_NOT_FOUND';
  end if;

  -- 'resolved' is deliberately unreachable here: it requires a documented
  -- resolution, so resolve_support_case is its only entry point.
  if not (
    (v_case.status = 'open' and p_to_status = 'in_progress')
    or (v_case.status = 'in_progress' and p_to_status = 'open')
    or (v_case.status = 'resolved' and p_to_status in ('in_progress', 'closed'))
  ) then
    raise exception 'SUPPORT_STATUS_TRANSITION_INVALID';
  end if;

  update public.support_cases
  set status = p_to_status,
      closed_at = case when p_to_status = 'closed' then now() else null end,
      -- Reopening clears the resolution fields (the constraint forbids them on
      -- an in-progress row). The resolution event stays in history forever.
      resolution_type = case when p_to_status = 'in_progress' then null else resolution_type end,
      resolution_amount = case when p_to_status = 'in_progress' then null else resolution_amount end,
      resolution_note = case when p_to_status = 'in_progress' then null else resolution_note end,
      resolved_by = case when p_to_status = 'in_progress' then null else resolved_by end,
      resolved_at = case when p_to_status = 'in_progress' then null else resolved_at end,
      updated_at = now()
  where id = p_case_id;

  insert into public.support_case_events (
    case_id, actor_role, actor_id, event_type, from_status, to_status
  )
  values (p_case_id, 'admin', v_uid, 'status_change', v_case.status, p_to_status);
end;
$$;

create or replace function public.resolve_support_case(
  p_case_id uuid,
  p_resolution_type text,
  p_resolution_note text,
  p_resolution_amount numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_case public.support_cases%rowtype;
begin
  if v_uid is null or not (select private.is_admin()) then
    raise exception 'ADMIN_REQUIRED' using errcode = '28000';
  end if;

  select * into v_case from public.support_cases where id = p_case_id for update;
  if v_case.id is null then
    raise exception 'SUPPORT_CASE_NOT_FOUND';
  end if;
  if v_case.status not in ('open', 'in_progress') then
    raise exception 'SUPPORT_STATUS_TRANSITION_INVALID';
  end if;
  if char_length(btrim(coalesce(p_resolution_note, ''))) = 0 then
    raise exception 'SUPPORT_RESOLUTION_NOTE_REQUIRED';
  end if;

  if p_resolution_type in ('refund', 'credit') then
    if p_resolution_amount is null or p_resolution_amount <= 0 then
      raise exception 'SUPPORT_RESOLUTION_AMOUNT_REQUIRED';
    end if;
  elsif p_resolution_amount is not null then
    raise exception 'SUPPORT_RESOLUTION_AMOUNT_NOT_ALLOWED';
  end if;

  -- Documentation only. This function must never write to bookings, payments,
  -- promotions or any balance: an admin carries the outcome out by hand.
  update public.support_cases
  set status = 'resolved',
      resolution_type = p_resolution_type,
      resolution_amount = p_resolution_amount,
      resolution_note = btrim(p_resolution_note),
      resolved_by = v_uid,
      resolved_at = now(),
      updated_at = now()
  where id = p_case_id;

  insert into public.support_case_events (
    case_id, actor_role, actor_id, event_type, body, from_status, to_status
  )
  values (p_case_id, 'admin', v_uid, 'resolution', btrim(p_resolution_note),
          v_case.status, 'resolved');
end;
$$;

create or replace function public.submit_booking_feedback(
  p_booking_id uuid,
  p_rating smallint,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'FEEDBACK_RATING_INVALID';
  end if;

  -- 'returned' is the stored status meaning the rental is complete.
  if not exists (
    select 1 from public.bookings as owned
    where owned.id = p_booking_id
      and owned.customer_id = v_uid
      and owned.status = 'returned'
  ) then
    raise exception 'FEEDBACK_NOT_ELIGIBLE';
  end if;

  insert into public.booking_feedback (booking_id, customer_id, rating, comment)
  values (p_booking_id, v_uid, p_rating, v_comment)
  on conflict (booking_id) do nothing;
end;
$$;

revoke all on function public.create_support_case(text, text, text, uuid) from public, anon;
revoke all on function public.add_support_case_message(uuid, text) from public, anon;
revoke all on function public.add_support_case_note(uuid, text) from public, anon;
revoke all on function public.update_support_case_status(uuid, text) from public, anon;
revoke all on function public.resolve_support_case(uuid, text, text, numeric) from public, anon;
revoke all on function public.submit_booking_feedback(uuid, smallint, text) from public, anon;

grant execute on function public.create_support_case(text, text, text, uuid) to authenticated;
grant execute on function public.add_support_case_message(uuid, text) to authenticated;
grant execute on function public.add_support_case_note(uuid, text) to authenticated;
grant execute on function public.update_support_case_status(uuid, text) to authenticated;
grant execute on function public.resolve_support_case(uuid, text, text, numeric) to authenticated;
grant execute on function public.submit_booking_feedback(uuid, smallint, text) to authenticated;

commit;
```

- [ ] **Step 6: Review the migration against the spec**

Re-read spec §5 and §6 with the file open and confirm, line by line: all four tables present with every listed column; `resolved` reachable only via `resolve_support_case`; reopening clears resolution fields; internal notes excluded from the customer RLS predicate; no table grants insert/update/delete to `authenticated`; `resolve_support_case` touches only `support_cases` and `support_case_events`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260930090000_support_cases_and_feedback.sql
git commit -m "feat: support case, history, attachment and feedback schema"
```

---

### Task 3: Guest continuity and the attachment bucket

**Files:**
- Create: `supabase/migrations/20260930091000_recover_guest_support_cases.sql`
- Modify: `src/lib/supabase/storage.ts`

**Interfaces:**
- Consumes: `private.recover_guest_booking_access(uuid, text, text, text)` from `20260823160730_recover_guest_booking_access.sql`.
- Produces: the `support-attachments` bucket; `STORAGE_BUCKETS.supportAttachments = "support-attachments"`.

This is Review Focus item 1. Without it, a guest who recovers their booking into a new anonymous session loses access to a complaint they already filed.

- [ ] **Step 1: Copy the existing function verbatim**

Open `supabase/migrations/20260823160730_recover_guest_booking_access.sql` and copy the **entire** `private.recover_guest_booking_access` definition (lines 6–118, through its `grant execute`) into the new file `supabase/migrations/20260930091000_recover_guest_support_cases.sql`, wrapped in `begin;` / `commit;`, under this header:

```sql
-- Guest booking recovery must carry support cases across to the new anonymous
-- session, exactly as it already does for notifications. Without this a guest
-- who recovers a booking silently loses access to their own complaint.
-- Every other line of the function is preserved verbatim.
```

- [ ] **Step 2: Add the one new block**

Inside the copied function, immediately after the existing `notifications` re-point (the `update public.notifications set user_id = v_uid ...` statement) and still inside the `if v_previous_customer_id <> v_uid then` branch, insert:

```sql
    update public.support_cases
    set customer_id = v_uid, updated_at = now()
    where booking_id = v_booking_id
      and customer_id = v_previous_customer_id;
```

Change nothing else. The `public.recover_guest_booking_access` wrapper (lines 120+ of the original) is unchanged and does not need to be re-declared.

- [ ] **Step 3: Add the storage bucket**

Append before `commit;`, following the pattern in `20260921120000_rental_fulfillment.sql:136`:

```sql
-- Private bucket. Uploads and reads both go through the server with the
-- service client, so no storage policy is granted to authenticated callers.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-attachments',
  'support-attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;
```

- [ ] **Step 4: Register the bucket in TypeScript**

In `src/lib/supabase/storage.ts`, add one entry to `STORAGE_BUCKETS`, after `conditionPhotos`:

```ts
  supportAttachments: "support-attachments",
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. Then confirm by reading both files side by side that the only differences are the added `support_cases` block and the bucket insert.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260930091000_recover_guest_support_cases.sql src/lib/supabase/storage.ts
git commit -m "feat: carry guest support cases through booking recovery"
```

---

### Task 4: Support case domain rules

**Files:**
- Create: `src/lib/support/supportCase.ts`
- Modify: `scripts/testSupportCases.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SUPPORT_CATEGORIES`, `SupportCategory`, `SUPPORT_CATEGORY_LABELS`, `SUPPORT_STATUSES`, `SupportStatus`, `SUPPORT_STATUS_LABELS`, `RESOLUTION_TYPES`, `ResolutionType`, `RESOLUTION_TYPE_LABELS`, `SupportCaseEvent`, `canAdminChangeStatus(from, to)`, `canCustomerReply(status)`, `validateResolution(input)`, `toCustomerVisibleEvents(events)`, `FollowUpState`, `FOLLOW_UP_LABELS`, `deriveFollowUpStates(input, now)`, `needsAttention(states)`.

Owns Review Focus items 2 (reopen) and 4 (resolution amount mismatch).

- [ ] **Step 1: Write the failing tests**

Append to `scripts/testSupportCases.ts`:

```ts
import {
  canAdminChangeStatus,
  canCustomerReply,
  validateResolution,
  toCustomerVisibleEvents,
  deriveFollowUpStates,
  needsAttention,
  type SupportCaseEvent,
} from "../src/lib/support/supportCase";

test("a case can only be resolved through the resolution flow", () => {
  assert.equal(canAdminChangeStatus("open", "in_progress"), true);
  assert.equal(canAdminChangeStatus("in_progress", "open"), true);
  assert.equal(canAdminChangeStatus("resolved", "closed"), true);
  // Resolving requires a documented outcome, so it is not a plain status move.
  assert.equal(canAdminChangeStatus("open", "resolved"), false);
  assert.equal(canAdminChangeStatus("in_progress", "resolved"), false);
  // A closed case is final; it is reopened by starting a new request.
  assert.equal(canAdminChangeStatus("closed", "open"), false);
  assert.equal(canAdminChangeStatus("open", "closed"), false);
});

test("a resolved case can be reopened, which returns it to in progress", () => {
  assert.equal(canAdminChangeStatus("resolved", "in_progress"), true);
});

test("customers may reply until the case is closed", () => {
  assert.equal(canCustomerReply("open"), true);
  assert.equal(canCustomerReply("in_progress"), true);
  assert.equal(canCustomerReply("resolved"), true);
  assert.equal(canCustomerReply("closed"), false);
});

test("a money resolution requires a positive amount", () => {
  assert.deepEqual(
    validateResolution({ resolutionType: "refund", note: "Refunded the delivery fee.", amount: null }),
    { ok: false, error: "Enter the amount for this refund." },
  );
  assert.deepEqual(
    validateResolution({ resolutionType: "credit", note: "Credit for the late unit.", amount: 0 }),
    { ok: false, error: "Enter the amount for this credit." },
  );
  assert.deepEqual(
    validateResolution({ resolutionType: "refund", note: "Refunded the delivery fee.", amount: 150 }),
    { ok: true },
  );
});

test("a non-money resolution rejects an amount", () => {
  // Storing an amount against a replacement would misrepresent what was agreed.
  assert.deepEqual(
    validateResolution({ resolutionType: "replacement", note: "Swapped the unit.", amount: 150 }),
    { ok: false, error: "A replacement resolution does not take an amount." },
  );
  assert.deepEqual(
    validateResolution({ resolutionType: "reschedule", note: "Moved to Oct 4.", amount: null }),
    { ok: true },
  );
});

test("every resolution requires a note", () => {
  assert.deepEqual(
    validateResolution({ resolutionType: "other", note: "   ", amount: null }),
    { ok: false, error: "Describe how this case was resolved." },
  );
});

const event = (overrides: Partial<SupportCaseEvent>): SupportCaseEvent => ({
  id: "event-1",
  actorRole: "customer",
  eventType: "message",
  body: "The unit arrived late.",
  fromStatus: null,
  toStatus: null,
  isInternal: false,
  createdAt: "2026-09-20T09:00:00.000Z",
  ...overrides,
});

test("internal notes never reach the customer timeline", () => {
  const visible = toCustomerVisibleEvents([
    event({ id: "a" }),
    event({ id: "b", actorRole: "admin", eventType: "admin_note", isInternal: true, body: "Check the courier log." }),
    event({ id: "c", actorRole: "admin", body: "We are looking into it." }),
  ]);
  assert.deepEqual(visible.map((item) => item.id), ["a", "c"]);
});

const NOW = new Date("2026-09-30T12:00:00.000Z");

test("a case with no admin reply yet needs a first reply", () => {
  const states = deriveFollowUpStates({
    status: "open",
    createdAt: "2026-09-30T11:00:00.000Z",
    firstAdminResponseAt: null,
    lastCustomerMessageAt: "2026-09-30T11:00:00.000Z",
    lastAdminMessageAt: null,
    resolvedAt: null,
  }, NOW);
  assert.deepEqual(states, ["needs_first_reply", "awaiting_admin_reply"]);
  assert.equal(needsAttention(states), true);
});

test("a case answered after the customer's last message needs nothing", () => {
  const states = deriveFollowUpStates({
    status: "in_progress",
    createdAt: "2026-09-30T08:00:00.000Z",
    firstAdminResponseAt: "2026-09-30T09:00:00.000Z",
    lastCustomerMessageAt: "2026-09-30T09:30:00.000Z",
    lastAdminMessageAt: "2026-09-30T10:00:00.000Z",
    resolvedAt: null,
  }, NOW);
  assert.deepEqual(states, []);
  assert.equal(needsAttention(states), false);
});

test("an old open case and a stale resolved case are both flagged", () => {
  const old = deriveFollowUpStates({
    status: "in_progress",
    createdAt: "2026-09-25T12:00:00.000Z",
    firstAdminResponseAt: "2026-09-25T13:00:00.000Z",
    lastCustomerMessageAt: null,
    lastAdminMessageAt: "2026-09-25T13:00:00.000Z",
    resolvedAt: null,
  }, NOW);
  assert.deepEqual(old, ["open_over_48h"]);

  const stale = deriveFollowUpStates({
    status: "resolved",
    createdAt: "2026-09-01T12:00:00.000Z",
    firstAdminResponseAt: "2026-09-01T13:00:00.000Z",
    lastCustomerMessageAt: null,
    lastAdminMessageAt: "2026-09-01T13:00:00.000Z",
    resolvedAt: "2026-09-10T12:00:00.000Z",
  }, NOW);
  assert.deepEqual(stale, ["resolved_awaiting_close"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test scripts/testSupportCases.ts`
Expected: FAIL — `Cannot find module '../src/lib/support/supportCase'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/support/supportCase.ts`:

```ts
export const SUPPORT_CATEGORIES = [
  "booking_issue",
  "payment_issue",
  "item_condition",
  "delivery_pickup",
  "account_access",
  "other",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  booking_issue: "Booking problem",
  payment_issue: "Payment problem",
  item_condition: "Item condition",
  delivery_pickup: "Delivery or pickup",
  account_access: "Account access",
  other: "Something else",
};

export const SUPPORT_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const RESOLUTION_TYPES = ["refund", "replacement", "credit", "reschedule", "other"] as const;
export type ResolutionType = (typeof RESOLUTION_TYPES)[number];

export const RESOLUTION_TYPE_LABELS: Record<ResolutionType, string> = {
  refund: "Refund",
  replacement: "Replacement unit",
  credit: "Credit toward a next rental",
  reschedule: "Rescheduled rental",
  other: "Other documented outcome",
};

/** Resolutions that record a peso figure. Everything else must not carry one. */
const MONEY_RESOLUTIONS: readonly ResolutionType[] = ["refund", "credit"];

/**
 * Admin status moves. 'resolved' is absent on purpose: reaching it requires a
 * documented outcome, so validateResolution + resolve_support_case own it.
 */
const ALLOWED_TRANSITIONS: Record<SupportStatus, readonly SupportStatus[]> = {
  open: ["in_progress"],
  in_progress: ["open"],
  resolved: ["in_progress", "closed"],
  closed: [],
};

export function canAdminChangeStatus(from: SupportStatus, to: SupportStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function canCustomerReply(status: SupportStatus): boolean {
  return status !== "closed";
}

export type ResolutionValidation = { ok: true } | { ok: false; error: string };

export function validateResolution(input: {
  resolutionType: ResolutionType;
  note: string;
  amount: number | null;
}): ResolutionValidation {
  if (input.note.trim().length === 0) {
    return { ok: false, error: "Describe how this case was resolved." };
  }
  const isMoney = MONEY_RESOLUTIONS.includes(input.resolutionType);
  if (isMoney) {
    if (input.amount === null || !Number.isFinite(input.amount) || input.amount <= 0) {
      return { ok: false, error: `Enter the amount for this ${input.resolutionType}.` };
    }
    return { ok: true };
  }
  if (input.amount !== null) {
    return {
      ok: false,
      error: `A ${input.resolutionType} resolution does not take an amount.`,
    };
  }
  return { ok: true };
}

export interface SupportCaseEvent {
  id: string;
  actorRole: "customer" | "admin" | "system";
  eventType: "message" | "admin_note" | "status_change" | "resolution";
  body: string | null;
  fromStatus: SupportStatus | null;
  toStatus: SupportStatus | null;
  isInternal: boolean;
  createdAt: string;
}

/**
 * The customer's view of the history. Internal notes are already excluded by
 * RLS; this is the second, independent barrier.
 */
export function toCustomerVisibleEvents(events: readonly SupportCaseEvent[]): SupportCaseEvent[] {
  return events.filter((item) => !item.isInternal);
}

export type FollowUpState =
  | "needs_first_reply"
  | "awaiting_admin_reply"
  | "open_over_48h"
  | "resolved_awaiting_close";

export const FOLLOW_UP_LABELS: Record<FollowUpState, string> = {
  needs_first_reply: "Needs first reply",
  awaiting_admin_reply: "Awaiting admin reply",
  open_over_48h: "Open over 48 hours",
  resolved_awaiting_close: "Resolved, awaiting close",
};

const HOURS_48 = 48 * 60 * 60 * 1000;
const DAYS_7 = 7 * 24 * 60 * 60 * 1000;

export interface FollowUpInput {
  status: SupportStatus;
  createdAt: string;
  firstAdminResponseAt: string | null;
  lastCustomerMessageAt: string | null;
  lastAdminMessageAt: string | null;
  resolvedAt: string | null;
}

/**
 * Internal admin triage only. These thresholds are never shown to a customer
 * and are not a response-time commitment.
 */
export function deriveFollowUpStates(input: FollowUpInput, now: Date): FollowUpState[] {
  const states: FollowUpState[] = [];
  const at = (value: string | null) => (value === null ? null : new Date(value).getTime());
  const created = new Date(input.createdAt).getTime();

  if (input.status === "open" && input.firstAdminResponseAt === null) {
    states.push("needs_first_reply");
  }

  const lastCustomer = at(input.lastCustomerMessageAt);
  if (lastCustomer !== null && lastCustomer > (at(input.lastAdminMessageAt) ?? created)) {
    states.push("awaiting_admin_reply");
  }

  if (
    (input.status === "open" || input.status === "in_progress") &&
    now.getTime() - created > HOURS_48
  ) {
    states.push("open_over_48h");
  }

  const resolved = at(input.resolvedAt);
  if (input.status === "resolved" && resolved !== null && now.getTime() - resolved > DAYS_7) {
    states.push("resolved_awaiting_close");
  }

  return states;
}

export function needsAttention(states: readonly FollowUpState[]): boolean {
  return states.length > 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test scripts/testSupportCases.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/support/supportCase.ts scripts/testSupportCases.ts
git commit -m "feat: support case status, resolution and follow-up rules"
```

---

### Task 5: Post-rental feedback rules

**Files:**
- Create: `src/lib/support/bookingFeedback.ts`
- Modify: `scripts/testSupportCases.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FEEDBACK_RATING_LABELS: Record<1|2|3|4|5, string>`, `isFeedbackEligible(input)`, `validateFeedback(input)`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/testSupportCases.ts`:

```ts
import { isFeedbackEligible, validateFeedback } from "../src/lib/support/bookingFeedback";

test("feedback is offered only for a completed rental the customer owns", () => {
  // 'returned' is the stored status that means the rental is complete.
  assert.equal(isFeedbackEligible({ bookingStatus: "returned", alreadySubmitted: false }), true);
  assert.equal(isFeedbackEligible({ bookingStatus: "released", alreadySubmitted: false }), false);
  assert.equal(isFeedbackEligible({ bookingStatus: "cancelled", alreadySubmitted: false }), false);
  assert.equal(isFeedbackEligible({ bookingStatus: "returned", alreadySubmitted: true }), false);
});

test("a rating outside one to five is rejected", () => {
  assert.deepEqual(validateFeedback({ rating: 0, comment: "" }), {
    ok: false,
    error: "Choose a rating from one to five.",
  });
  assert.deepEqual(validateFeedback({ rating: 6, comment: "" }), {
    ok: false,
    error: "Choose a rating from one to five.",
  });
  assert.deepEqual(validateFeedback({ rating: 3.5, comment: "" }), {
    ok: false,
    error: "Choose a rating from one to five.",
  });
  assert.deepEqual(validateFeedback({ rating: 4, comment: "" }), { ok: true });
});

test("a comment longer than 1000 characters is rejected", () => {
  assert.deepEqual(validateFeedback({ rating: 5, comment: "x".repeat(1001) }), {
    ok: false,
    error: "Comments must be 1,000 characters or fewer.",
  });
  assert.deepEqual(validateFeedback({ rating: 5, comment: "x".repeat(1000) }), { ok: true });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test scripts/testSupportCases.ts`
Expected: FAIL — `Cannot find module '../src/lib/support/bookingFeedback'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/support/bookingFeedback.ts`:

```ts
export const FEEDBACK_RATING_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Very unsatisfied",
  2: "Unsatisfied",
  3: "Neutral",
  4: "Satisfied",
  5: "Very satisfied",
};

/**
 * 'returned' is the stored status meaning the rental is complete. Feedback is
 * offered once per completed booking and is never editable afterwards.
 */
export function isFeedbackEligible(input: {
  bookingStatus: string;
  alreadySubmitted: boolean;
}): boolean {
  return input.bookingStatus === "returned" && !input.alreadySubmitted;
}

export type FeedbackValidation = { ok: true } | { ok: false; error: string };

export function validateFeedback(input: { rating: number; comment: string }): FeedbackValidation {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, error: "Choose a rating from one to five." };
  }
  if (input.comment.length > 1000) {
    return { ok: false, error: "Comments must be 1,000 characters or fewer." };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test scripts/testSupportCases.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/support/bookingFeedback.ts scripts/testSupportCases.ts
git commit -m "feat: post-rental feedback eligibility and validation"
```

---

### Task 6: Customer support case API

**Files:**
- Create: `app/api/support/cases/route.ts`
- Create: `app/api/support/cases/[caseId]/route.ts`
- Create: `app/api/support/cases/[caseId]/messages/route.ts`

**Interfaces:**
- Consumes: `create_support_case`, `add_support_case_message` (Task 2); `SUPPORT_CATEGORIES`, `toCustomerVisibleEvents`, `canCustomerReply` (Task 4); `requireUser`, `enforceRateLimit`, `RequestSecurityError`.
- Produces: `GET /api/support/cases` → `{ cases: SupportCaseSummary[] }`; `POST /api/support/cases` → `{ caseId, caseReference }`; `GET /api/support/cases/:caseId` → `{ case: SupportCaseDetail }`; `POST /api/support/cases/:caseId/messages` → `{ eventId }`. `SupportCaseSummary` = `{ id, caseReference, category, subject, status, bookingId, bookingRef, createdAt, updatedAt, lastActivityAt }`. `SupportCaseDetail` = `SupportCaseSummary & { events: SupportCaseEvent[], resolutionType, resolutionAmount, resolutionNote, resolvedAt, canReply, attachments: { id, fileName, mimeType, sizeBytes }[] }`.

Owns Review Focus item 3: an unauthorised case id must return 404, never 403.

- [ ] **Step 1: Write the list and create route**

Create `app/api/support/cases/route.ts`. Follow the error-handling shape of `app/api/bookings/[bookingId]/review/route.ts`.

```ts
import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  requireUser,
  RequestSecurityError,
} from "@/src/lib/server/requestSecurity";
import { SUPPORT_CATEGORIES, type SupportCategory } from "@/src/lib/support/supportCase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    enforceRateLimit(request, "support-cases-read", 60, 60_000);
    const { supabase } = await requireUser();

    // RLS restricts this to the caller's own cases.
    const { data, error } = await supabase
      .from("support_cases")
      .select(
        "id, case_reference, category, subject, status, booking_id, created_at, updated_at, " +
          "last_customer_message_at, last_admin_message_at, bookings(booking_reference)",
      )
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) return errorResponse("Your requests could not be loaded.", 503);

    const cases = (data ?? []).map((row) => ({
      id: row.id,
      caseReference: row.case_reference,
      category: row.category,
      subject: row.subject,
      status: row.status,
      bookingId: row.booking_id,
      bookingRef:
        (row.bookings as { booking_reference: string } | null)?.booking_reference ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivityAt: row.updated_at,
    }));

    return NextResponse.json({ cases });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Support case list failed", error);
    return errorResponse("Your requests could not be loaded.", 500);
  }
}

export async function POST(request: Request) {
  try {
    enforceRateLimit(request, "support-case-create", 5, 60_000);
    const { supabase } = await requireUser();
    const body = (await request.json().catch(() => null)) as {
      category?: unknown;
      subject?: unknown;
      message?: unknown;
      bookingId?: unknown;
    } | null;

    const category = typeof body?.category === "string" ? body.category : "";
    const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const bookingId = typeof body?.bookingId === "string" && body.bookingId ? body.bookingId : null;

    if (!SUPPORT_CATEGORIES.includes(category as SupportCategory)) {
      return errorResponse("Choose what your request is about.", 400);
    }
    if (subject.length < 3 || subject.length > 120) {
      return errorResponse("Give your request a short subject (3–120 characters).", 400);
    }
    if (message.length < 10) {
      return errorResponse("Describe the problem in at least 10 characters.", 400);
    }
    if (message.length > 2000) {
      return errorResponse("Messages must be 2,000 characters or fewer.", 400);
    }

    const { data, error } = await supabase
      .rpc("create_support_case", {
        p_category: category,
        p_subject: subject,
        p_message: message,
        p_booking_id: bookingId,
      })
      .single();

    if (error) {
      if (error.message.includes("SUPPORT_BOOKING_NOT_FOUND")) {
        return errorResponse("That booking is not available from your account.", 404);
      }
      if (error.message.includes("SUPPORT_MESSAGE_TOO_SHORT")) {
        return errorResponse("Describe the problem in at least 10 characters.", 400);
      }
      console.error("Support case creation failed", error);
      return errorResponse("We couldn't send your request right now. Please try again.", 500);
    }

    return NextResponse.json(
      { caseId: data.case_id, caseReference: data.case_reference },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Support case creation failed", error);
    return errorResponse("We couldn't send your request right now. Please try again.", 500);
  }
}
```

- [ ] **Step 2: Write the case detail route**

Create `app/api/support/cases/[caseId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  requireUser,
  RequestSecurityError,
} from "@/src/lib/server/requestSecurity";
import {
  canCustomerReply,
  toCustomerVisibleEvents,
  type SupportCaseEvent,
  type SupportStatus,
} from "@/src/lib/support/supportCase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    enforceRateLimit(request, "support-case-read", 90, 60_000);
    const { supabase } = await requireUser();
    const { caseId } = await params;

    const { data: row, error } = await supabase
      .from("support_cases")
      .select(
        "id, case_reference, category, subject, status, booking_id, created_at, updated_at, " +
          "resolution_type, resolution_amount, resolution_note, resolved_at, " +
          "bookings(booking_reference)",
      )
      .eq("id", caseId)
      .maybeSingle();

    if (error) return errorResponse("This request could not be loaded.", 503);
    // RLS hides another customer's case, so it arrives here as "not found".
    // Answering 404 rather than 403 keeps a case id from confirming it exists.
    if (!row) return errorResponse("This request is not available from your account.", 404);

    const { data: eventRows, error: eventsError } = await supabase
      .from("support_case_events")
      .select("id, actor_role, event_type, body, from_status, to_status, is_internal, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true });

    if (eventsError) return errorResponse("This request could not be loaded.", 503);

    const events: SupportCaseEvent[] = (eventRows ?? []).map((item) => ({
      id: item.id,
      actorRole: item.actor_role,
      eventType: item.event_type,
      body: item.body,
      fromStatus: item.from_status,
      toStatus: item.to_status,
      isInternal: item.is_internal,
      createdAt: item.created_at,
    }));

    const { data: attachments } = await supabase
      .from("support_case_attachments")
      .select("id, file_name, mime_type, size_bytes")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true });

    return NextResponse.json({
      case: {
        id: row.id,
        caseReference: row.case_reference,
        category: row.category,
        subject: row.subject,
        status: row.status,
        bookingId: row.booking_id,
        bookingRef:
          (row.bookings as { booking_reference: string } | null)?.booking_reference ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        resolutionType: row.resolution_type,
        resolutionAmount: row.resolution_amount,
        resolutionNote: row.resolution_note,
        resolvedAt: row.resolved_at,
        canReply: canCustomerReply(row.status as SupportStatus),
        // Second, independent barrier: RLS already excludes internal notes.
        events: toCustomerVisibleEvents(events),
        attachments: (attachments ?? []).map((file) => ({
          id: file.id,
          fileName: file.file_name,
          mimeType: file.mime_type,
          sizeBytes: file.size_bytes,
        })),
      },
    });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Support case read failed", error);
    return errorResponse("This request could not be loaded.", 500);
  }
}
```

- [ ] **Step 3: Write the reply route**

Create `app/api/support/cases/[caseId]/messages/route.ts`. It calls `add_support_case_message`, which resolves the caller's role itself, so one route serves customers, guests, and admins.

```ts
import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  requireUser,
  RequestSecurityError,
} from "@/src/lib/server/requestSecurity";
import { notifySupportCaseReply } from "@/src/lib/server/supportNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    enforceRateLimit(request, "support-case-reply", 20, 60_000);
    const { supabase } = await requireUser();
    const { caseId } = await params;
    const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (message.length === 0) return errorResponse("Write a message before sending.", 400);
    if (message.length > 2000) {
      return errorResponse("Messages must be 2,000 characters or fewer.", 400);
    }

    const { data: eventId, error } = await supabase.rpc("add_support_case_message", {
      p_case_id: caseId,
      p_body: message,
    });

    if (error) {
      if (error.message.includes("SUPPORT_CASE_NOT_FOUND")) {
        return errorResponse("This request is not available from your account.", 404);
      }
      if (error.message.includes("SUPPORT_CASE_CLOSED")) {
        return errorResponse("This request is closed. Please start a new one.", 409);
      }
      console.error("Support case reply failed", error);
      return errorResponse("Your message could not be sent. Please try again.", 500);
    }

    await notifySupportCaseReply(caseId, eventId as string);
    return NextResponse.json({ eventId }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Support case reply failed", error);
    return errorResponse("Your message could not be sent. Please try again.", 500);
  }
}
```

`notifySupportCaseReply` is built in Task 12. Until then, temporarily comment out its import and call, and restore both in Task 12 Step 5.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. Confirm by reading the code that neither the 404 path nor the 403 path can be distinguished by a caller: an unauthorised id and a missing id both produce "This request is not available from your account." with status 404.

- [ ] **Step 5: Commit**

```bash
git add app/api/support/
git commit -m "feat: customer support case API"
```

---

### Task 7: Case attachments

**Files:**
- Create: `app/api/support/cases/[caseId]/attachments/route.ts`

**Interfaces:**
- Consumes: `createAdminClient`, `createSignedUrl`, `STORAGE_BUCKETS.supportAttachments`, `requireUser`.
- Produces: `POST /api/support/cases/:caseId/attachments` (multipart, field `file`) → `{ attachmentId, fileName }`; `GET /api/support/cases/:caseId/attachments?attachmentId=…` → `{ url }`.

- [ ] **Step 1: Write the route**

Create `app/api/support/cases/[caseId]/attachments/route.ts`. The ownership check runs on the caller's own RLS-scoped client *before* the service client touches storage — the same shape as `app/api/bookings/[bookingId]/documents/upload/route.ts`.

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { STORAGE_BUCKETS, createSignedUrl } from "@/src/lib/supabase/storage";
import {
  enforceRateLimit,
  requireUser,
  RequestSecurityError,
} from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    enforceRateLimit(request, "support-attachment-upload", 15, 60_000);
    const { supabase, user } = await requireUser();
    const { caseId } = await params;

    // RLS scopes this read, so a case the caller cannot see reads as missing.
    const { data: owned } = await supabase
      .from("support_cases")
      .select("id")
      .eq("id", caseId)
      .maybeSingle();
    if (!owned) return errorResponse("This request is not available from your account.", 404);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return errorResponse("Choose a file to attach.", 400);
    if (file.size === 0 || file.size > MAX_BYTES) {
      return errorResponse("Attachments must be 10 MB or smaller.", 400);
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return errorResponse("Attach a JPG, PNG, WEBP, or PDF file.", 400);
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${caseId}/${Date.now()}-${safeName}`;
    const admin = createAdminClient();

    const { error: uploadError } = await admin.storage
      .from(STORAGE_BUCKETS.supportAttachments)
      .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) {
      console.error("Support attachment upload failed", uploadError);
      return errorResponse("That file could not be uploaded. Please try again.", 500);
    }

    const { data: inserted, error: insertError } = await admin
      .from("support_case_attachments")
      .insert({
        case_id: caseId,
        storage_path: storagePath,
        file_name: safeName,
        mime_type: file.type,
        size_bytes: file.size,
        uploaded_by: user.id,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      // Do not leave an orphaned object behind when the row fails to write.
      await admin.storage.from(STORAGE_BUCKETS.supportAttachments).remove([storagePath]);
      console.error("Support attachment record failed", insertError);
      return errorResponse("That file could not be attached. Please try again.", 500);
    }

    return NextResponse.json({ attachmentId: inserted.id, fileName: safeName }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Support attachment upload failed", error);
    return errorResponse("That file could not be uploaded. Please try again.", 500);
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    enforceRateLimit(request, "support-attachment-read", 60, 60_000);
    const { supabase } = await requireUser();
    const { caseId } = await params;
    const attachmentId = new URL(request.url).searchParams.get("attachmentId") ?? "";

    // Read through the caller's own client: RLS decides whether they may see it.
    const { data: attachment } = await supabase
      .from("support_case_attachments")
      .select("storage_path")
      .eq("id", attachmentId)
      .eq("case_id", caseId)
      .maybeSingle();
    if (!attachment) return errorResponse("This file is not available from your account.", 404);

    const url = await createSignedUrl(
      createAdminClient(),
      STORAGE_BUCKETS.supportAttachments,
      attachment.storage_path,
    );
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Support attachment read failed", error);
    return errorResponse("This file could not be opened.", 500);
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/support/cases/
git commit -m "feat: support case attachment upload and signed reads"
```

---

### Task 8: Customer support list and new-request form

**Files:**
- Create: `components/support/SupportStatusChip.tsx` + `.module.css`
- Create: `components/support/SupportCaseForm.tsx` + `.module.css`
- Create: `app/account/support/page.tsx` + `support.module.css`
- Modify: `components/navbar/Navbar.tsx`

**Interfaces:**
- Consumes: `GET`/`POST /api/support/cases` (Task 6); `SUPPORT_CATEGORIES`, `SUPPORT_CATEGORY_LABELS`, `SUPPORT_STATUS_LABELS` (Task 4).
- Produces: `<SupportStatusChip status={SupportStatus} />`; `<SupportCaseForm bookings={{ id, bookingRef }[]} lockedBookingId?: string | null onCreated={(result: { caseId: string; caseReference: string }) => void} />`.

These are **client components** using `useAuth` and `fetch`, matching `app/account/bookings/page.tsx`.

- [ ] **Step 1: Build the status chip**

Create `components/support/SupportStatusChip.tsx`:

```tsx
import { SUPPORT_STATUS_LABELS, type SupportStatus } from "@/src/lib/support/supportCase";
import styles from "./SupportStatusChip.module.css";

const CLASS_BY_STATUS: Record<SupportStatus, string> = {
  open: styles.open,
  in_progress: styles.inProgress,
  resolved: styles.resolved,
  closed: styles.closed,
};

export default function SupportStatusChip({ status }: { status: SupportStatus }) {
  return (
    <span className={`${styles.chip} ${CLASS_BY_STATUS[status]}`}>
      {SUPPORT_STATUS_LABELS[status]}
    </span>
  );
}
```

In `SupportStatusChip.module.css`, give `.chip` a pill shape (`border-radius: 999px`, `padding: 0.25rem 0.75rem`, `font-weight: 600`, `font-size: 0.8125rem`). Each status gets its own background/foreground pair from the existing palette, all meeting **WCAG AA (4.5:1)** against their own background. The status word itself carries the meaning — colour is never the only signal. Copy the token names already used in `components/status-badge/StatusBadge.module.css`.

- [ ] **Step 2: Build the form**

Create `components/support/SupportCaseForm.tsx` as a `"use client"` component. State: `category`, `subject`, `message`, `bookingId`, `files: File[]`, `submitting`, `error`, `fieldErrors`.

Structure and required behaviour:

```tsx
<form className={styles.form} onSubmit={handleSubmit} noValidate>
  <div className={styles.field}>
    <label htmlFor="support-category">What is this about?</label>
    <select
      id="support-category"
      value={category}
      onChange={(event) => setCategory(event.target.value as SupportCategory)}
      aria-describedby={fieldErrors.category ? "support-category-error" : undefined}
      aria-invalid={fieldErrors.category ? true : undefined}
      required
    >
      <option value="">Choose a topic</option>
      {SUPPORT_CATEGORIES.map((value) => (
        <option key={value} value={value}>{SUPPORT_CATEGORY_LABELS[value]}</option>
      ))}
    </select>
    {fieldErrors.category ? (
      <p id="support-category-error" className={styles.fieldError}>{fieldErrors.category}</p>
    ) : null}
  </div>
  {/* booking select (omitted when lockedBookingId is set — render a read-only
      line naming the booking instead), subject input, message textarea with a
      live character counter, and an optional file input accepting
      "image/jpeg,image/png,image/webp,application/pdf" with multiple. */}
  <p className={styles.privacyNote}>
    Only you and the Maddy &amp; Cassy team can see this request.
  </p>
  <Button type="submit" variant="primary" disabled={submitting}>
    {submitting ? "Sending…" : "Send request"}
  </Button>
  <p className={styles.status} role="status" aria-live="polite">{error ?? ""}</p>
</form>
```

Every field gets a real `<label htmlFor>`; every error is tied by `aria-describedby` and `aria-invalid`. Client-side validation mirrors the server rules from Task 6 exactly (category required, subject 3–120, message 10–2000) so the two never disagree.

`handleSubmit` posts to `/api/support/cases`, then — only if files were chosen — posts each one to `/api/support/cases/${caseId}/attachments` as `FormData` with field `file`. A failed attachment upload does **not** discard the case: show "Your request was sent, but <name> could not be attached." and still call `onCreated`.

- [ ] **Step 3: Build the list page**

Create `app/account/support/page.tsx` as `"use client"`. It loads `GET /api/support/cases`, and renders:

- an `<h1>My support requests</h1>` header with a "New request" toggle that reveals `<SupportCaseForm>`;
- the case list — each row a `<Link href={`/account/support/${item.id}`}>` showing subject, `<SupportStatusChip>`, category label, booking reference when present, and the real `updatedAt` formatted with the same helper the bookings list uses;
- a loading `<Spinner />`;
- an error state offering Retry plus `<SupportHelpCallout>` (Task 10);
- an **empty state**: "You have not sent any support requests yet." with the new-request action and the official channels. No sample rows.

After a successful submit, show a success panel naming the case reference and its real creation time. It must not state or imply when a reply will arrive.

- [ ] **Step 4: Add the account navigation entry**

In `components/navbar/Navbar.tsx`, add `<Link href="/account/support">Support</Link>` beside the existing `"/account/payments"` links in **both** the profile menu (around line 353) and the mobile menu (around line 487), inside the same `!isAdmin` guard the mobile one already uses. Read the file first — it has uncommitted edits. Change nothing else.

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`, sign in as a customer, and open `/account/support`. Confirm: the empty state renders (no invented rows); submitting with an empty category shows an inline error and moves focus to it; a valid submit shows the reference; the page is usable at 375 px wide with no horizontal scroll; every control is reachable by keyboard with a visible focus ring.

Note: until the migrations in Tasks 2–3 are applied, the API returns an error and the error state is what renders. That is expected and is itself worth checking.

- [ ] **Step 6: Commit**

```bash
git add components/support/ app/account/support/ components/navbar/Navbar.tsx
git commit -m "feat: customer support request list and form"
```

---

### Task 9: Customer case thread

**Files:**
- Create: `components/support/SupportCaseTimeline.tsx` + `.module.css`
- Create: `app/account/support/[caseId]/page.tsx` + `case.module.css`

**Interfaces:**
- Consumes: `GET /api/support/cases/:caseId`, `POST /api/support/cases/:caseId/messages`, `GET /api/support/cases/:caseId/attachments?attachmentId=` (Tasks 6–7); `SupportCaseEvent`, `SUPPORT_STATUS_LABELS`, `RESOLUTION_TYPE_LABELS` (Task 4).
- Produces: `<SupportCaseTimeline events={SupportCaseEvent[]} showInternal={boolean} />` — reused by the admin screen in Task 11.

- [ ] **Step 1: Build the timeline**

Create `components/support/SupportCaseTimeline.tsx`. It renders an ordered list, one entry per event, each carrying an author label, an absolute timestamp in a `<time dateTime={createdAt}>`, and a body.

```tsx
const AUTHOR_LABEL: Record<SupportCaseEvent["actorRole"], string> = {
  customer: "You",
  admin: "Maddy & Cassy team",
  system: "System",
};

export default function SupportCaseTimeline({
  events,
  showInternal = false,
  customerLabel = "You",
}: {
  events: readonly SupportCaseEvent[];
  showInternal?: boolean;
  customerLabel?: string;
}) {
  const visible = showInternal ? events : events.filter((item) => !item.isInternal);

  return (
    <ol className={styles.timeline}>
      {visible.map((item) => (
        <li
          key={item.id}
          className={`${styles.entry} ${item.isInternal ? styles.internal : ""}`}
        >
          <div className={styles.meta}>
            <span className={styles.author}>
              {item.actorRole === "customer" ? customerLabel : AUTHOR_LABEL[item.actorRole]}
            </span>
            {item.isInternal ? (
              <span className={styles.internalTag}>Internal note — staff only</span>
            ) : null}
            <time dateTime={item.createdAt}>{formatTimestamp(item.createdAt)}</time>
          </div>
          {item.eventType === "status_change" ? (
            <p className={styles.systemLine}>
              Status changed from {SUPPORT_STATUS_LABELS[item.fromStatus!]} to{" "}
              {SUPPORT_STATUS_LABELS[item.toStatus!]}.
            </p>
          ) : (
            <p className={styles.body}>{item.body}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
```

`showInternal` defaults to `false`, so a caller that forgets the prop leaks nothing. `formatTimestamp` is a local helper using `toLocaleString("en-PH")`, matching how the bookings pages format dates.

Style `.internal` with a distinct left border and a tinted background so a staff note can never be mistaken for a customer-visible reply.

- [ ] **Step 2: Build the case page**

Create `app/account/support/[caseId]/page.tsx` as `"use client"`, reading `caseId` from `useParams()`. Sections, in order:

1. **Header** — back link to `/account/support`, the subject as `<h1>`, the case reference, `<SupportStatusChip>`, the category label, the booking reference linking to `/account/bookings/{bookingId}` when present, and `<time>` for when it was opened.
2. **Resolution panel** — rendered only when `resolutionType` is set: the label from `RESOLUTION_TYPE_LABELS`, the amount formatted as `₱{amount.toLocaleString("en-PH")}` **only when present**, the note, and the resolved timestamp.
3. **Timeline** — `<SupportCaseTimeline events={case.events} />` with no `showInternal` prop.
4. **Attachments** — each a button that fetches the signed URL on click and opens it in a new tab. Never render a raw storage path.
5. **Reply box** — rendered when `canReply`; otherwise a closed-case notice with a link to start a new request. Posts to `/api/support/cases/${caseId}/messages`, then refetches. A `role="status" aria-live="polite"` region announces success and failure.

A 404 from the API renders "This request is not available from your account." plus `<SupportHelpCallout>` — the same copy whether the case is missing or belongs to someone else.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`, then check in the browser at 375 px and with keyboard only. Confirm the timeline is readable top-to-bottom by a screen reader (it is an `<ol>` of `<li>`s with real timestamps) and that no element on the page renders an `isInternal` event.

- [ ] **Step 4: Commit**

```bash
git add components/support/SupportCaseTimeline.tsx components/support/SupportCaseTimeline.module.css app/account/support/
git commit -m "feat: customer support case thread"
```

---

### Task 10: Booking-level support entry points and post-rental feedback

**Files:**
- Create: `components/support/SupportHelpCallout.tsx` + `.module.css`
- Create: `components/support/BookingFeedbackPanel.tsx` + `.module.css`
- Create: `app/api/bookings/[bookingId]/feedback/route.ts`
- Modify: `app/account/bookings/[bookingId]/page.tsx`, `app/guest/bookings/[bookingId]/page.tsx`, `app/account/bookings/page.tsx`
- Modify: `src/lib/server/rentalCompletedEmail.ts`

**Interfaces:**
- Consumes: `SUPPORT_CHANNELS`, `SERVICE_WINDOW`, `SUPPORT_RESPONSE_STANDARD` (Task 1); `isFeedbackEligible`, `validateFeedback`, `FEEDBACK_RATING_LABELS` (Task 5); `submit_booking_feedback` (Task 2).
- Produces: `<SupportHelpCallout bookingId?: string | null heading?: string guestMode?: boolean />`; `<BookingFeedbackPanel bookingId bookingStatus alreadySubmitted />`; `POST /api/bookings/:bookingId/feedback` → `{ submitted: true }`.

- [ ] **Step 1: Build the help callout**

Create `components/support/SupportHelpCallout.tsx` (a server-safe component — no `"use client"`, no state):

```tsx
export default function SupportHelpCallout({
  bookingId = null,
  heading = "Need help?",
  guestMode = false,
}: {
  bookingId?: string | null;
  heading?: string;
  /** Guests have no /account area, so the account link is omitted for them. */
  guestMode?: boolean;
}) {
  return (
    <aside className={styles.callout} aria-labelledby="support-callout-heading">
      <h2 id="support-callout-heading" className={styles.heading}>{heading}</h2>
      <p className={styles.window}>
        Pickup and delivery appointments are scheduled between {SERVICE_WINDOW}.
      </p>
      {SUPPORT_RESPONSE_STANDARD ? (
        <p className={styles.standard}>{SUPPORT_RESPONSE_STANDARD}</p>
      ) : null}
      <ul className={styles.channels}>
        {SUPPORT_CHANNELS.map((channel) => (
          <li key={channel.id}>
            <a
              href={channel.href}
              target={channel.href.startsWith("http") ? "_blank" : undefined}
              rel={channel.href.startsWith("http") ? "noreferrer" : undefined}
            >
              {channel.label}: {channel.value}
            </a>
          </li>
        ))}
      </ul>
      {guestMode ? null : (
        <Link
          href={bookingId ? `/account/support?bookingId=${bookingId}` : "/account/support"}
          className={styles.reportLink}
        >
          {bookingId ? "Report a problem with this rental" : "Send a support request"}
        </Link>
      )}
    </aside>
  );
}
```

The response-standard line is guarded, so while `SUPPORT_RESPONSE_STANDARD` is `null` nothing about reply times is rendered.

- [ ] **Step 2: Write the feedback route**

Create `app/api/bookings/[bookingId]/feedback/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  requireUser,
  RequestSecurityError,
} from "@/src/lib/server/requestSecurity";
import { validateFeedback } from "@/src/lib/support/bookingFeedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    enforceRateLimit(request, "booking-feedback", 10, 60_000);
    const { supabase } = await requireUser();
    const { bookingId } = await params;
    const body = (await request.json().catch(() => null)) as {
      rating?: unknown;
      comment?: unknown;
    } | null;

    const rating = typeof body?.rating === "number" ? body.rating : Number.NaN;
    const comment = typeof body?.comment === "string" ? body.comment.trim() : "";

    const validation = validateFeedback({ rating, comment });
    if (!validation.ok) return errorResponse(validation.error, 400);

    const { error } = await supabase.rpc("submit_booking_feedback", {
      p_booking_id: bookingId,
      p_rating: rating,
      p_comment: comment || null,
    });

    if (error) {
      if (error.message.includes("FEEDBACK_NOT_ELIGIBLE")) {
        return errorResponse(
          "Feedback can be sent once the rental has been completed and returned.",
          409,
        );
      }
      console.error("Booking feedback submission failed", error);
      return errorResponse("Your feedback could not be sent. Please try again.", 500);
    }

    return NextResponse.json({ submitted: true }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Booking feedback submission failed", error);
    return errorResponse("Your feedback could not be sent. Please try again.", 500);
  }
}
```

The RPC uses `on conflict do nothing`, so a double submit is harmless and still reports success.

- [ ] **Step 3: Build the feedback panel**

Create `components/support/BookingFeedbackPanel.tsx` as `"use client"`. When `isFeedbackEligible({ bookingStatus, alreadySubmitted })` is false, render either a thank-you line (already submitted) or nothing at all (not yet complete) — never a disabled form.

The rating input is a **radio group**, not five buttons, so it is keyboard- and screen-reader-native:

```tsx
<fieldset className={styles.ratings}>
  <legend>How satisfied were you with this rental?</legend>
  {[1, 2, 3, 4, 5].map((value) => (
    <label key={value} className={styles.rating}>
      <input
        type="radio"
        name="satisfaction"
        value={value}
        checked={rating === value}
        onChange={() => setRating(value)}
      />
      <span>{value}</span>
      <span className={styles.ratingLabel}>
        {FEEDBACK_RATING_LABELS[value as 1 | 2 | 3 | 4 | 5]}
      </span>
    </label>
  ))}
</fieldset>
```

Below it: an optional labelled comment textarea with a character counter, a submit button, and a `role="status" aria-live="polite"` result region. Include the explanatory line:

> This rating is private and about the service. To review a specific item publicly, use the review section above.

- [ ] **Step 4: Wire the booking pages**

**One component already serves both audiences.** `app/account/bookings/[bookingId]/page.tsx` exports `BookingDetailContent({ guestMode = false })` (line 110), and `app/guest/bookings/[bookingId]/page.tsx` is a 13-line wrapper that renders it with `guestMode`. Edit the shared component once; do **not** add a separate guest code path.

In `app/account/bookings/[bookingId]/page.tsx`:

- Beside the existing `<CustomerReviewPanel>` (line 504), add `<BookingFeedbackPanel>` and, below it, `<SupportHelpCallout bookingId={details.booking.id} />`. Both render in guest mode too — a guest owns their booking through an anonymous auth user, so the RPCs accept them unchanged.
- Read whether feedback already exists with a `booking_feedback` select on the viewer's own (RLS-scoped) client and pass it as `alreadySubmitted`.
- In the booking-not-found branch (the `<Button href="/account/bookings">` block at line 219), add `<SupportHelpCallout />`.
- `SupportHelpCallout`'s "Report a problem" link points at `/account/support`, which requires an account. Give the component a `guestMode` prop: when true, render the channels and omit that link, since a guest files a case from this page rather than from an account area. Add the case form inline here for guests in the same place, using `<SupportCaseForm lockedBookingId={details.booking.id} />`.

Verify line numbers before editing — this file is 660 lines and moves with upstream merges.

In `app/account/bookings/page.tsx`, add `<SupportHelpCallout />` to the error state and to the empty-list state. Leave the loyalty section untouched.

- [ ] **Step 5: Add the feedback link to the completion email**

In `src/lib/server/rentalCompletedEmail.ts`, add one sentence with a link to `{siteUrl}/account/bookings/{bookingId}` inviting the customer to rate the rental, alongside the existing loyalty sentence. Use the same URL helper the file already uses. Do not create a new email, do not change the subject, and do not alter the loyalty copy.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run test:support`
Then in the browser, on a booking whose status is `returned`: the panel appears, submits, and afterwards shows the thank-you line. On a booking that is not returned, no panel renders. Check the radio group is operable with arrow keys and that the support callout links work on mobile.

- [ ] **Step 7: Commit**

```bash
git add components/support/ app/api/bookings/ app/account/bookings/ app/guest/bookings/ src/lib/server/rentalCompletedEmail.ts
git commit -m "feat: booking support entry points and post-rental feedback"
```

---

### Task 11: Admin support inbox

**Files:**
- Create: `app/api/admin/support/route.ts`, `app/api/admin/support/[caseId]/route.ts`, `app/api/admin/support/[caseId]/notes/route.ts`
- Create: `app/admin/support/page.tsx`, `app/admin/support/AdminSupportManager.tsx` + `.module.css`
- Modify: `components/admin/AdminShell.tsx`

**Interfaces:**
- Consumes: `requireActiveAdmin`, `createAdminClient`; `update_support_case_status`, `resolve_support_case`, `add_support_case_note` (Task 2); `deriveFollowUpStates`, `needsAttention`, `validateResolution`, `canAdminChangeStatus`, `FOLLOW_UP_LABELS` (Task 4); `<SupportCaseTimeline>` (Task 9).
- Produces: `GET /api/admin/support?status=&category=&attention=` → `{ cases: AdminCaseSummary[] }` where `AdminCaseSummary` = `{ id, caseReference, subject, category, status, customerName, customerEmail, bookingRef, createdAt, updatedAt, followUpStates: FollowUpState[] }`; `GET /api/admin/support/:caseId` → `{ case: AdminCaseDetail }` (all events, internal notes included); `PATCH /api/admin/support/:caseId` `{ status }`; `POST /api/admin/support/:caseId` `{ resolutionType, resolutionNote, resolutionAmount }`; `POST /api/admin/support/:caseId/notes` `{ body }`.

- [ ] **Step 1: Write the inbox API**

Create `app/api/admin/support/route.ts`. Follow `app/api/admin/reviews/route.ts` exactly: call `requireActiveAdmin()` first, then use `createAdminClient()` so customer identity never reaches a browser-side Supabase query, and resolve names via a single `profiles` lookup.

```ts
const admin = createAdminClient();
const { data, error } = await admin
  .from("support_cases")
  .select(
    "id, case_reference, subject, category, status, customer_id, created_at, updated_at, " +
      "first_admin_response_at, last_customer_message_at, last_admin_message_at, resolved_at, " +
      "resolution_type, resolution_amount, bookings(booking_reference)",
  )
  .order("updated_at", { ascending: false })
  .limit(500);
if (error) throw new Error(error.message);

const now = new Date();
const cases = (data ?? []).map((row) => {
  const followUpStates = deriveFollowUpStates(
    {
      status: row.status,
      createdAt: row.created_at,
      firstAdminResponseAt: row.first_admin_response_at,
      lastCustomerMessageAt: row.last_customer_message_at,
      lastAdminMessageAt: row.last_admin_message_at,
      resolvedAt: row.resolved_at,
    },
    now,
  );
  const profile = profileById.get(row.customer_id);
  return {
    id: row.id,
    caseReference: row.case_reference,
    subject: row.subject,
    category: row.category,
    status: row.status,
    customerName: profile?.display_name ?? "Customer",
    customerEmail: profile?.contact_email ?? null,
    bookingRef: (row.bookings as { booking_reference: string } | null)?.booking_reference ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    followUpStates,
  };
});
```

Apply the `status`, `category`, and `attention` query filters in TypeScript after the mapping (`attention=true` keeps rows where `needsAttention(followUpStates)`), since follow-up state is derived, not stored.

- [ ] **Step 2: Write the case detail and action API**

Create `app/api/admin/support/[caseId]/route.ts` with three handlers, each starting `await requireActiveAdmin()`:

- `GET` — the case plus **all** its events, internal notes included (this is the admin view), shaped like Task 6's detail response with the extra `isInternal` flag preserved.
- `PATCH` — reads `{ status }`, rejects it up front with 400 when `canAdminChangeStatus(current, next)` is false so the UI gets a clear message rather than a Postgres error, then calls `update_support_case_status`. Map `SUPPORT_STATUS_TRANSITION_INVALID` to 409. Afterwards call `notifySupportCaseStatusChange(caseId, status)`.
- `POST` — reads `{ resolutionType, resolutionNote, resolutionAmount }`, runs `validateResolution` and returns its `error` with 400 when not ok, then calls `resolve_support_case`. Map `SUPPORT_RESOLUTION_AMOUNT_REQUIRED` and `SUPPORT_RESOLUTION_AMOUNT_NOT_ALLOWED` to 400 with the same wording `validateResolution` produces. Afterwards call `notifySupportCaseResolved(caseId)`.

Both notify functions come from Task 12; comment them out until then.

Create `app/api/admin/support/[caseId]/notes/route.ts`: `requireActiveAdmin()`, validate a non-empty body of ≤ 2000 characters, call `add_support_case_note`. **It sends no customer notification** — an internal note is invisible to the customer.

- [ ] **Step 3: Build the admin screen**

Create `app/admin/support/page.tsx` (a thin server page rendering the manager inside the existing admin layout, matching `app/admin/reviews/page.tsx`) and `app/admin/support/AdminSupportManager.tsx` as `"use client"`, modelled on `app/admin/reviews/AdminReviewsManager.tsx`.

Left: the filterable case list. Each row shows the reference, subject, customer, status chip, and its follow-up badges rendered from `FOLLOW_UP_LABELS` — text labels, not bare colours. Filters: status, category, and a "Needs attention" toggle.

Right: the selected case —
1. header with customer, booking reference (linking to `/admin/bookings/{bookingId}`), category, status, and real timestamps;
2. `<SupportCaseTimeline events={detail.events} showInternal customerLabel={detail.customerName} />`;
3. a reply box posting to `/api/support/cases/${caseId}/messages` (the shared endpoint resolves the admin role itself);
4. an internal-note box, visually marked staff-only, posting to `/api/admin/support/${caseId}/notes`;
5. status controls offering only the transitions `canAdminChangeStatus` permits from the current status;
6. a **Resolve** form: resolution type `<select>`, an amount field that appears only for `refund` and `credit`, and a required note. It runs `validateResolution` before posting so the admin sees the error inline.

Above the resolve form, state plainly:

> Recording a resolution documents what was agreed. It does not issue a refund, credit, replacement, or reschedule — carry that out in the booking and payment screens.

After every successful action, refetch both the list and the detail so derived follow-up states stay accurate.

- [ ] **Step 4: Add the navigation entry**

In `components/admin/AdminShell.tsx`, add `{ href: "/admin/support", label: "Support Cases" }` to the group that already contains `/admin/messages` (around line 35), directly after Messages. Change nothing else.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint`. In the browser as an admin: filters narrow the list; a status change is rejected with a clear message when invalid; resolving with `replacement` shows no amount field and succeeds; switching to `refund` requires an amount; an internal note appears in the admin timeline marked staff-only. Then open the same case as the customer and confirm the note is absent.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/support/ app/admin/support/ components/admin/AdminShell.tsx
git commit -m "feat: admin support case inbox with documented resolutions"
```

---

### Task 12: Support notifications and emails

**Files:**
- Create: `src/lib/server/supportNotifications.ts`
- Modify: `app/api/support/cases/route.ts`, `app/api/support/cases/[caseId]/messages/route.ts`, `app/api/admin/support/[caseId]/route.ts`

**Interfaces:**
- Consumes: `createAdminClient`, `sendEmail` from `src/lib/server/emailTransport.ts`, `public.notifications`, `public.admin_notifications`, `RESOLUTION_TYPE_LABELS`.
- Produces: `notifySupportCaseCreated(caseId: string)`, `notifySupportCaseReply(caseId: string, eventId: string)`, `notifySupportCaseStatusChange(caseId: string, status: SupportStatus)`, `notifySupportCaseResolved(caseId: string)` — all `Promise<void>`, all non-throwing.

- [ ] **Step 1: Write the module**

Create `src/lib/server/supportNotifications.ts`. Every function follows the same three rules, mirroring `sendBookingStatusEmail`: load the case with the service client; write the in-app notification row; attempt the email last. **Never throw** — a notification failure must not roll back a case action that already succeeded.

```ts
import "server-only";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { sendEmail } from "@/src/lib/server/emailTransport";
import { RESOLUTION_TYPE_LABELS, type ResolutionType } from "@/src/lib/support/supportCase";

interface CaseContext {
  id: string;
  caseReference: string;
  subject: string;
  status: string;
  customerId: string;
  contactEmail: string | null;
  displayName: string | null;
  resolutionType: ResolutionType | null;
  resolutionAmount: number | null;
  resolutionNote: string | null;
}

async function loadCase(caseId: string): Promise<CaseContext | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("support_cases")
    .select(
      "id, case_reference, subject, status, customer_id, resolution_type, " +
        "resolution_amount, resolution_note, profiles:customer_id(display_name, contact_email)",
    )
    .eq("id", caseId)
    .maybeSingle();
  if (!data) return null;
  const profile = data.profiles as { display_name: string | null; contact_email: string | null } | null;
  return {
    id: data.id,
    caseReference: data.case_reference,
    subject: data.subject,
    status: data.status,
    customerId: data.customer_id,
    contactEmail: profile?.contact_email ?? null,
    displayName: profile?.display_name ?? null,
    resolutionType: data.resolution_type,
    resolutionAmount: data.resolution_amount,
    resolutionNote: data.resolution_note,
  };
}

async function notifyCustomer(
  context: CaseContext,
  notificationType: string,
  title: string,
  message: string,
  withEmail: boolean,
): Promise<void> {
  const admin = createAdminClient();
  const actionUrl = `/account/support/${context.id}`;

  const { error } = await admin.from("notifications").insert({
    user_id: context.customerId,
    notification_type: notificationType,
    title,
    message,
    action_url: actionUrl,
  });
  if (error) console.error("Support notification insert failed", error);

  if (!withEmail || !context.contactEmail) return;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  await sendEmail({
    to: context.contactEmail,
    subject: `${title} — ${context.caseReference}`,
    text: `${message}\n\nView your request: ${siteUrl}${actionUrl}`,
    html: `<p>${message}</p><p><a href="${siteUrl}${actionUrl}">View your request</a></p>`,
    // One send per case per notification type; a retry cannot double-send.
    idempotencyKey: `support-${notificationType}-${context.id}`,
    tags: [{ name: "category", value: "support" }],
    logContext: { caseId: context.id },
  });
}
```

Then the four exported functions:

- `notifySupportCaseCreated(caseId)` — inserts one `admin_notifications` row per active admin (select their ids from `profiles` the same way the existing admin-notification code does), titled "New support request", with `action_url` `/admin/support`. **No customer email**: the customer already saw the confirmation on screen, and an email here would imply a reply is coming.
- `notifySupportCaseReply(caseId)` — looks at the most recent event's `actor_role`. For `admin`, calls `notifyCustomer(..., "support_reply", "Maddy & Cassy replied to your request", …, true)`. For `customer`, writes admin notifications only.
- `notifySupportCaseStatusChange(caseId, status)` — customer notification, **no email** (status moves are low-signal).
- `notifySupportCaseResolved(caseId)` — customer notification **with** email, whose body names `RESOLUTION_TYPE_LABELS[resolutionType]`, the amount when present, and the resolution note verbatim.

The idempotency key for a reply must include the event id (`support-reply-${eventId}`) so a second reply on the same case still sends; pass the event id into the function for that case.

- [ ] **Step 2: Wire case creation**

In `app/api/support/cases/route.ts` `POST`, after the successful RPC call, `await notifySupportCaseCreated(data.case_id);` inside a `try/catch` that only logs — a notification failure must not turn a created case into an error response.

- [ ] **Step 3: Restore the reply hook**

In `app/api/support/cases/[caseId]/messages/route.ts`, uncomment the `notifySupportCaseReply` import and call from Task 6 Step 3, passing the returned `eventId`.

- [ ] **Step 4: Restore the admin hooks**

In `app/api/admin/support/[caseId]/route.ts`, uncomment `notifySupportCaseStatusChange` in `PATCH` and `notifySupportCaseResolved` in `POST`. The notes route stays untouched — internal notes notify nobody.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint`. Then read each of the four functions and confirm: none can throw past its own `try/catch`; the notes route imports nothing from this module; and no string in the file mentions a reply time.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/supportNotifications.ts app/api/support/ app/api/admin/support/
git commit -m "feat: support case notifications and emails"
```

---

### Task 13: Retention and satisfaction metrics

**Files:**
- Create: `src/lib/support/retentionMetrics.ts`
- Create: `scripts/testRetentionMetrics.ts`
- Create: `app/api/admin/retention/route.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `COMPLETED_RENTALS_BEFORE_REWARD` from `src/lib/promotions.ts`; `requireActiveAdmin`, `createAdminClient`.
- Produces: `summariseSatisfaction(rows)`, `summariseRepeatCustomers(rows)`, `SatisfactionSummary`, `RepeatCustomerSummary`, `CustomerRetentionRow`; `GET /api/admin/retention` → `{ repeat, satisfaction, reviews, cases }`.

Owns Review Focus item 5: an empty `booking_feedback` table must never read as a zero score.

- [ ] **Step 1: Write the failing tests**

Create `scripts/testRetentionMetrics.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  summariseSatisfaction,
  summariseRepeatCustomers,
} from "../src/lib/support/retentionMetrics";
import { COMPLETED_RENTALS_BEFORE_REWARD } from "../src/lib/promotions";

test("no satisfaction responses reads as no data, never as zero", () => {
  const summary = summariseSatisfaction([]);
  assert.equal(summary.responseCount, 0);
  // A 0 here would read as total dissatisfaction. Absence is not a score.
  assert.equal(summary.average, null);
  assert.deepEqual(summary.distribution, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
});

test("the satisfaction average and distribution come only from real responses", () => {
  const summary = summariseSatisfaction([{ rating: 5 }, { rating: 4 }, { rating: 4 }]);
  assert.equal(summary.responseCount, 3);
  assert.equal(summary.average, 4.3);
  assert.deepEqual(summary.distribution, { 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 });
});

test("no completed rentals reads as no data", () => {
  const summary = summariseRepeatCustomers([]);
  assert.equal(summary.totalCustomers, 0);
  assert.equal(summary.repeatCustomers, 0);
  assert.equal(summary.repeatRate, null);
  assert.deepEqual(summary.perCustomer, []);
});

test("a repeat customer is one with two or more completed rentals", () => {
  const summary = summariseRepeatCustomers([
    { customerId: "a", customerName: "Ana" },
    { customerId: "a", customerName: "Ana" },
    { customerId: "a", customerName: "Ana" },
    { customerId: "b", customerName: "Ben" },
  ]);
  assert.equal(summary.totalCustomers, 2);
  assert.equal(summary.repeatCustomers, 1);
  assert.equal(summary.repeatRate, 0.5);
  // Highest completed count first.
  assert.deepEqual(
    summary.perCustomer.map((row) => [row.customerId, row.completedRentals]),
    [["a", 3], ["b", 1]],
  );
});

test("loyalty progress uses the existing rule, not a hardcoded number", () => {
  const rows = Array.from({ length: COMPLETED_RENTALS_BEFORE_REWARD }, () => ({
    customerId: "a",
    customerName: "Ana",
  }));
  const [customer] = summariseRepeatCustomers(rows).perCustomer;
  assert.equal(customer.completedRentals, COMPLETED_RENTALS_BEFORE_REWARD);
  assert.equal(customer.rentalsUntilReward, 0);
  assert.equal(customer.hasRewardAvailable, true);

  const [early] = summariseRepeatCustomers([
    { customerId: "b", customerName: "Ben" },
  ]).perCustomer;
  assert.equal(early.rentalsUntilReward, COMPLETED_RENTALS_BEFORE_REWARD - 1);
  assert.equal(early.hasRewardAvailable, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test scripts/testRetentionMetrics.ts`
Expected: FAIL — `Cannot find module '../src/lib/support/retentionMetrics'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/support/retentionMetrics.ts`:

```ts
import { COMPLETED_RENTALS_BEFORE_REWARD } from "@/src/lib/promotions";

export interface SatisfactionSummary {
  responseCount: number;
  /** Null when nobody has responded. Absence of data is not a score of zero. */
  average: number | null;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

export function summariseSatisfaction(
  rows: readonly { rating: number }[],
): SatisfactionSummary {
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) {
    const key = row.rating as 1 | 2 | 3 | 4 | 5;
    if (key in distribution) distribution[key] += 1;
  }
  if (rows.length === 0) {
    return { responseCount: 0, average: null, distribution };
  }
  const total = rows.reduce((sum, row) => sum + row.rating, 0);
  return {
    responseCount: rows.length,
    average: Math.round((total / rows.length) * 10) / 10,
    distribution,
  };
}

export interface CustomerRetentionRow {
  customerId: string;
  customerName: string;
  completedRentals: number;
  /** Uses the existing loyalty rule from promotions.ts. Never a hardcoded number. */
  rentalsUntilReward: number;
  hasRewardAvailable: boolean;
}

export interface RepeatCustomerSummary {
  totalCustomers: number;
  repeatCustomers: number;
  /** Null when no customer has completed a rental yet. */
  repeatRate: number | null;
  perCustomer: CustomerRetentionRow[];
}

/**
 * Input is one row per completed booking ('returned'), so the counts are the
 * same derivation the customer sees on their own loyalty progress.
 */
export function summariseRepeatCustomers(
  rows: readonly { customerId: string; customerName: string }[],
): RepeatCustomerSummary {
  const counts = new Map<string, { name: string; completed: number }>();
  for (const row of rows) {
    const existing = counts.get(row.customerId);
    if (existing) existing.completed += 1;
    else counts.set(row.customerId, { name: row.customerName, completed: 1 });
  }

  const perCustomer: CustomerRetentionRow[] = [...counts.entries()]
    .map(([customerId, value]) => ({
      customerId,
      customerName: value.name,
      completedRentals: value.completed,
      rentalsUntilReward: Math.max(0, COMPLETED_RENTALS_BEFORE_REWARD - value.completed),
      hasRewardAvailable: value.completed >= COMPLETED_RENTALS_BEFORE_REWARD,
    }))
    .sort((a, b) => b.completedRentals - a.completedRentals);

  const totalCustomers = perCustomer.length;
  const repeatCustomers = perCustomer.filter((row) => row.completedRentals >= 2).length;

  return {
    totalCustomers,
    repeatCustomers,
    repeatRate: totalCustomers === 0 ? null : repeatCustomers / totalCustomers,
    perCustomer,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test scripts/testRetentionMetrics.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the metrics API**

Create `app/api/admin/retention/route.ts`. Start with `await requireActiveAdmin()`, then use `createAdminClient()` to read four sets of real rows and pass them through the pure functions:

```ts
const admin = createAdminClient();
const [bookings, feedback, reviews, cases] = await Promise.all([
  // 'returned' is the stored status meaning the rental is complete.
  admin.from("bookings").select("customer_id, profiles:customer_id(display_name)").eq("status", "returned"),
  admin.from("booking_feedback").select("rating"),
  admin.from("reviews").select("status"),
  admin.from("support_cases").select(
    "status, created_at, first_admin_response_at, last_customer_message_at, last_admin_message_at, resolved_at",
  ),
]);
```

Map bookings to `{ customerId, customerName }` and call `summariseRepeatCustomers`; call `summariseSatisfaction(feedback.data ?? [])`; count reviews by status into `{ pending, approved, rejected }`; count cases by status and compute `needsAttention` totals with `deriveFollowUpStates(row, new Date())`. Return all four groups. Compute nothing the rows do not support — if a query errors, return 503 rather than substituting zeros.

- [ ] **Step 6: Register the test script**

In `package.json`, add `"test:retention": "tsx --test scripts/testRetentionMetrics.ts"` and insert `npm run test:retention && ` into `verify` immediately after `npm run test:support`.

- [ ] **Step 7: Verify and commit**

Run: `npm run test:retention && npx tsc --noEmit && npm run lint`

```bash
git add src/lib/support/retentionMetrics.ts scripts/testRetentionMetrics.ts app/api/admin/retention/ package.json
git commit -m "feat: retention and satisfaction metrics from real rows"
```

---

### Task 14: Review visibility, feedback tab, and the retention panel

**Files:**
- Modify: `app/api/admin/reviews/route.ts`, `app/admin/reviews/AdminReviewsManager.tsx` + its `.module.css`
- Create: `app/admin/retention/page.tsx`, `app/admin/retention/AdminRetentionPanel.tsx` + `.module.css`
- Modify: `components/admin/AdminShell.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/retention` (Task 13); the existing `GET /api/admin/reviews` and `PATCH /api/admin/catalog/reviews/:reviewId`.
- Produces: the reviews response gains `completedAt: string | null` and `verifiedRental: boolean`; a new `/admin/retention` screen.

Reviews are already restricted to completed rentals, and `PATCH /api/admin/catalog/reviews/[reviewId]/route.ts` accepts **only** `status` — rating and comment cannot be edited through any endpoint. This task adds visibility, and must not add an edit path.

- [ ] **Step 1: Extend the reviews API**

In `app/api/admin/reviews/route.ts`, add the fulfillment join to the existing select so the rental's real completion date is available, and extend `ReviewQueryRow` to match:

```ts
        booking_items(
          booking_id,
          product_id,
          product_name_snapshot,
          products(name),
          bookings(
            booking_reference,
            customer_id,
            status,
            booking_fulfillment_records(actual_return_at)
          )
        )
```

In the mapping, add:

```ts
      // A review can only be written against a returned booking, so the badge
      // is justified by the row's own booking link, never assumed.
      verifiedRental: booking?.status === "returned",
      completedAt:
        (booking?.booking_fulfillment_records as { actual_return_at: string | null }[] | null)
          ?.[0]?.actual_return_at ?? null,
```

When `completedAt` is null the UI shows "—". Never substitute another date.

- [ ] **Step 2: Show the new fields**

In `app/admin/reviews/AdminReviewsManager.tsx`, add to each review card: the product name (already present — keep it), the booking reference linking to `/admin/bookings/{bookingId}`, the submission date, the rental completion date (or "—"), and a **Verified rental** badge rendered only when `verifiedRental` is true. Add a short line under the heading:

> Reviews come only from customers who completed this rental. You can publish or hide a review; its rating and words are the customer's and cannot be changed here.

Keep the existing approve/reject buttons exactly as they are. Add no textarea, no rating control, and no edit affordance of any kind.

- [ ] **Step 3: Add the satisfaction tab**

Add a tab or section to the same manager listing CSAT responses read from `GET /api/admin/retention` (`satisfaction.responses`): rating, comment when present, booking reference, and date — all read-only. Extend the retention route's satisfaction group with a `responses` array (`booking_feedback` joined to `bookings(booking_reference)`, newest first, limit 200) to supply it.

Its empty state reads "No satisfaction responses yet." — not a zero, not a chart of zeros.

- [ ] **Step 4: Build the retention panel**

Create `app/admin/retention/page.tsx` (thin server page, matching `app/admin/reviews/page.tsx`) and `AdminRetentionPanel.tsx` as `"use client"` reading `GET /api/admin/retention`.

Tiles, each stating its own denominator:

| Tile | Content |
|---|---|
| Repeat customers | `repeatCustomers` of `totalCustomers`, plus the rate as a percentage — **only when `repeatRate !== null`**; otherwise "No completed rentals yet" |
| Completed rentals per customer | a table from `perCustomer`: name, completed rentals, loyalty progress ("`completedRentals` of `COMPLETED_RENTALS_BEFORE_REWARD`", or "Reward available" when `hasRewardAvailable`) |
| Reviews | counts by status |
| Support cases | counts by status plus the needs-attention total, linking to `/admin/support?attention=true` |
| Satisfaction | `average` with the label "from N responses"; when `average === null`, "No satisfaction responses yet" |

Guard every numeric render behind its null check. A tile must never print `0`, `NaN`, `0%`, or `—%` in place of "no data yet". Loyalty figures come from `perCustomer`, which already used the `promotions.ts` constants — do not recompute them here.

- [ ] **Step 5: Add the navigation entry**

In `components/admin/AdminShell.tsx`, add `{ href: "/admin/retention", label: "Customer Retention" }` to the group containing `/admin/reviews`, directly after "Feedback & Reviews".

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint`. In the browser as an admin, confirm: every review shows its booking reference and verified badge; no control anywhere can alter a review's rating or text; `/admin/retention` renders honest empty states on a database with no feedback rows; the tables scroll rather than overflow at 375 px.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/reviews/route.ts app/admin/reviews/ app/admin/retention/ components/admin/AdminShell.tsx
git commit -m "feat: review provenance, satisfaction tab and retention panel"
```

---

### Task 15: Full verification and migration handover

**Files:**
- Modify: none, unless verification finds a defect.

**Interfaces:**
- Consumes: everything built in Tasks 1–14.
- Produces: a green `npm run verify` and a written handover for applying the migrations.

- [ ] **Step 1: Run the full suite**

Run: `npm run verify`
Expected: lint clean, `tsc --noEmit` clean, every existing test suite still passing (payments, checkout, bookings, documents, auth, rental timing, variant inventory, feedback messages, messaging, fulfillment), the two new suites passing, and `next build` succeeding.

If an **existing** suite fails, stop and fix the regression. None of this work should change existing behaviour.

- [ ] **Step 2: Audit the constraints that matter**

Confirm by reading, not by assuming:

```bash
grep -rn "same-day\|same day\|within 24\|24 hours\|response time" app components src --include=*.tsx --include=*.ts
```

Expected: no customer-facing copy promising a reply time. (`FOLLOW_UP_LABELS`' "Open over 48 hours" is admin-only triage and is allowed.)

```bash
grep -rn "is_internal" app/api/support app/account
```

Expected: internal notes are filtered out, never rendered, on every customer path.

```bash
grep -n "bookings\|payment\|promotion" supabase/migrations/20260930090000_support_cases_and_feedback.sql
```

Expected: inside `resolve_support_case`, no write to any of them — only the ownership check in `create_support_case` and `submit_booking_feedback` read `bookings`.

- [ ] **Step 3: Confirm nothing was deleted**

Run: `git diff --stat main...HEAD` and read the list. Every entry should be an addition or an additive modification. No file removed, no table dropped, no route deleted, no existing test removed from `verify`.

- [ ] **Step 4: Hand the migrations over**

The two migrations are **not applied** by this plan. Report to the human:

> Two migrations are ready but unapplied: `20260930090000_support_cases_and_feedback.sql` and `20260930091000_recover_guest_support_cases.sql`. The support and feedback screens will show their error states until these run. Given the earlier `booking_payment_submissions` drift, apply them and then confirm `support_cases`, `support_case_events`, `support_case_attachments`, and `booking_feedback` all exist with their constraints, and that the `support-attachments` bucket is present and **not** public, before exposing the screens.

- [ ] **Step 5: Manual acceptance pass**

With the migrations applied, walk both paths end to end:

**Registered customer:** file a case with an attachment from a booking page → see it in `/account/support` → admin replies → customer sees the reply and the notification, and no internal note → admin resolves with a refund and an amount → customer sees the resolution → admin closes → the customer can no longer reply and is offered a new request.

**Guest:** track a booking, file a case against it, then recover the same booking with the reference, email, and phone in a fresh browser session. **The case must still be visible.** This is the failure the Task 3 migration exists to prevent; if the case disappears, that migration did not apply.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: address verification findings"
```

(Skip if verification was clean — do not create an empty commit.)

---

## Self-Review

Run against the spec before handing the plan over. Findings are fixed inline.

**Spec coverage:** §4.1 → Task 1. §4.2 → Tasks 8, 10. §4.3 → Tasks 6, 8. §4.4 → Tasks 6, 9. §4.5 → Tasks 5, 10. §5.1–5.3, §5.5, §5.6 → Task 2. §5.4 → Task 3. §6 → Task 2 (RPCs), Tasks 6, 11 (callers). §7.1 → Task 11. §7.2 → Task 14. §7.3 → Tasks 13, 14. §8 → Task 12. §9 → Tasks 4, 5, 13, 15. §10 → distributed through Tasks 8–11, 14, audited in Task 15. §11 → the Global Constraints section plus the Task 15 audit. No gaps.

**Placeholder scan:** no "TBD", no "handle edge cases", no "similar to Task N". Two deliberate forward references — `notifySupportCase*` in Tasks 6 and 11 — are called out at their use sites with the instruction to stub and the exact step in Task 12 that restores them.

**Type consistency:** `SupportStatus`, `SupportCategory`, `ResolutionType`, `SupportCaseEvent`, and `FollowUpState` are defined once in Task 4 and imported everywhere after. `summariseSatisfaction` / `summariseRepeatCustomers` are named identically in Task 13's tests, implementation, and API consumer. `STORAGE_BUCKETS.supportAttachments` is declared in Task 3 and used in Task 7.

**Review Focus coverage:** item 1 → Task 3 (migration) and Task 15 Step 5 (guest recovery walkthrough); item 2 → Task 4's reopen test and Task 2's constraint; item 3 → Task 6's 404-not-403 path, checked in Task 6 Step 4; item 4 → Task 4's two resolution-amount tests; item 5 → Task 13's empty-satisfaction test and Task 14's null guards.

