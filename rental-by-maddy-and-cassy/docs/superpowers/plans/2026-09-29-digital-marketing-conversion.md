# Digital Marketing & Sales Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the site's "Digital Marketing and Sales Conversion" rubric coverage by making the existing Birthday/Loyalty perks clearer, adding an admin-manageable promotions system with real redeemable checkout codes, a consent-based newsletter signup, first-party conversion analytics, an admin marketing metrics view, SEO/OG metadata, and a CTA hierarchy pass — reusing existing patterns everywhere possible and fabricating nothing.

**Architecture:** Additive Supabase migrations (new tables + two narrowly-scoped SECURITY DEFINER RPCs) layered on top of the existing booking system without touching the complex, multi-overload `create_multi_day_time_based_booking` / `create_multi_item_booking` RPCs. Promotion codes are validated with a read-only preview RPC before booking creation, then redeemed with a second RPC immediately *after* a booking is created (mirroring the existing non-fatal "fire it after success" pattern already used for the signed-agreement PDF) — this keeps the two booking-creation RPCs (and their two overloads) completely unmodified, which is the deliberate way of avoiding the kind of RPC-signature/schema drift that broke `/admin/payments` before. Analytics events are logged through a `log_marketing_event` RPC modeled directly on the existing `private.log_audit_event` helper. All new admin UI follows the existing `AdminShell` + `requireActiveAdmin()` + plain `useState`/`fetch`/`<table>` pattern used by `AdminCatalogManager.tsx` — no new libraries.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS + SECURITY DEFINER RPCs), TypeScript, existing `node:test` + `tsx` script convention (`scripts/test*.ts` wired into `npm run verify`), Resend for email (existing `src/lib/server/emailTransport.ts`).

**Spec:** This plan's spec is the user's own rubric-satisfying requirements list (no separate spec doc was written — the requirements were fully enumerated in the original request and are restated per-task below).

## Global Constraints

- Do not modify `public.create_multi_day_time_based_booking` (either overload), `public.create_multi_item_booking`, or their `_unscoped` helpers — promotion discounts are applied via a separate `redeem_promotion` RPC called after booking creation succeeds, never inside those functions.
- Every new SECURITY DEFINER function uses `set search_path = ''` and fully-qualifies every reference (`public.table`, `auth.uid()`, `private.function`) — this is the existing convention in every migration in `supabase/migrations/`.
- Admin-only tables follow the exact RLS pattern from `supabase/migrations/20260914120000_admin_notifications.sql`: `enable row level security`, a `create policy ... using ((select private.is_admin()))`, then `revoke all ... from anon, authenticated` + `grant select[, update] ... to authenticated` + `grant all ... to service_role`.
- No new npm dependency is introduced anywhere in this plan (no analytics SDK, no form library, no table library) — match what's already in `package.json`.
- Every new admin page/route uses `requireActiveAdmin()` + `enforceRateLimit()` from `src/lib/server/requestSecurity.ts`, exactly like `app/api/admin/catalog/route.ts`.
- Never fabricate metrics, campaigns, social accounts, or customer counts. The admin marketing metrics view only ever renders values computed from real rows in `bookings`, `promotions`, `promotion_redemptions`, `newsletter_subscribers`, and `analytics_events`.
- Guest checkouts (`bookings.is_guest_checkout = true`) are excluded from promotion redemption, exactly as they already are from the birthday/loyalty perks (`supabase/migrations/20260823090000_guest_booking_tracking.sql`).
- Every migration in this plan is additive (`add column`, `create table`, `create or replace function` with a strictly-widened signature) — nothing drops or narrows an existing column, table, or function signature.
- Migrations are applied to the live Supabase project only after the user reviews and confirms each one (per the user's explicit choice) — never run `supabase db push` without that per-migration confirmation.
- Keep existing Poppins typography and the pink/cream editorial visual style for every new UI element; reuse existing CSS custom properties/tokens rather than inventing new colors.

## Review Focus

- **A promo code that is valid at preview time but becomes invalid before redemption** (another customer exhausts `usage_limit` in the gap between preview and booking submission) — `redeem_promotion` must re-check everything from scratch under a row lock, not trust the earlier preview. Pinned in Task 2.
- **A customer submitting the same promo code on two different bookings created in quick succession** (double-submit / two browser tabs) — `per_customer_limit` and the `unique (booking_id)` constraint on `promotion_redemptions` must make the second redemption fail cleanly, not double-discount or corrupt `current_uses`. Pinned in Task 2.
- **An admin scheduling a promotion with `starts_at` in the future or `ends_at` in the past** — the storefront banner and `preview_promotion` must both treat it as not-currently-active (not merely "is_active flag" but also the date window), so a scheduled-but-not-started promotion never silently discounts anyone early. Pinned in Tasks 1, 2, 7.
- **An email already subscribed to the newsletter submitting the signup form again** (duplicate prevention) — must return a friendly "already subscribed" response, not a raw unique-constraint error, and must not create a second row. Pinned in Task 10.
- **A malformed or spoofed `utm_*`/event payload from the client** — `log_marketing_event` must reject an unrecognized `event_type` (checked against the same allow-list as the table's `check` constraint) rather than silently inserting garbage that later corrupts the admin metrics view. Pinned in Task 4.

---

## File Structure

**New files:**
- `supabase/migrations/20260929090000_promotions_schema.sql` — `promotions` + `promotion_redemptions` tables, `active_promotions` view, `preview_promotion` RPC.
- `supabase/migrations/20260929091000_redeem_promotion.sql` — `bookings` columns, `redeem_promotion` RPC, `booking_totals` view extension.
- `supabase/migrations/20260929092000_newsletter_subscribers.sql` — `newsletter_subscribers` table + `subscribe_newsletter`/`unsubscribe_newsletter` RPCs.
- `supabase/migrations/20260929093000_analytics_events.sql` — `analytics_events` table + `log_marketing_event` RPC.
- `supabase/migrations/20260929094000_marketing_metrics.sql` — `get_marketing_metrics` admin RPC.
- `app/api/admin/promotions/route.ts`, `app/api/admin/promotions/[id]/route.ts`
- `app/api/promotions/validate/route.ts`, `app/api/promotions/active/route.ts`
- `app/api/newsletter/subscribe/route.ts`
- `app/api/analytics/track/route.ts`
- `app/api/admin/newsletter/route.ts`
- `app/api/admin/marketing/metrics/route.ts`
- `app/admin/marketing/page.tsx`, `components/admin/AdminMarketingManager.tsx`, `components/admin/AdminMarketingManager.module.css`
- `components/promotions/ActivePromotionsBanner.tsx`, `.module.css`
- `components/newsletter/NewsletterSignup.tsx`, `.module.css`
- `app/unsubscribe/page.tsx`, `UnsubscribeClient.tsx`
- `src/lib/analytics/track.ts`
- `app/sitemap.ts`, `app/robots.ts`
- `scripts/testPromotions.ts`, `scripts/testNewsletter.ts`, `scripts/testAnalyticsTrack.ts`, `scripts/testMarketingCopy.ts`

**Modified files:** `components/admin/AdminShell.tsx` (nav link), `app/layout.tsx` (OG/twitter metadata), `app/page.tsx` (homepage metadata), `app/catalog/page.tsx` (OG metadata + banner), `app/catalog/[id]/page.tsx` (OG metadata), `app/cart/CartView.tsx` (banner), `components/reservation/StepPaymentSubmission.tsx` + `StepCartPaymentSubmission.tsx` (promo code UI), `app/catalog/[id]/reserve/ReserveFlowClient.tsx` + `app/checkout/CheckoutFlowClient.tsx` (redeem call + tracking calls), `components/footer/SiteFooter.tsx` (newsletter signup), `components/reserve-action/ReserveAction.tsx` + `components/catalog-product-card/CatalogProductCard.tsx` (tracking calls + CTA hierarchy), `package.json` (`verify` script gains new `test:*` entries).

---

## Task 1: Promotions schema, public preview surface

**Files:**
- Create: `supabase/migrations/20260929090000_promotions_schema.sql`
- Test: `scripts/testPromotions.ts`

**Interfaces:**
- Produces: `public.promotions` table (`id, code, title, description, discount_type ('percentage'|'fixed'), discount_value, max_discount_amount, min_subtotal, starts_at, ends_at, is_active, usage_limit, per_customer_limit, current_uses, created_by, created_at, updated_at`); `public.promotion_redemptions` table (`id, promotion_id, booking_id, customer_id, discount_amount, created_at`, `unique(booking_id)`); `public.active_promotions` view (safe public columns of currently-active promotions); `public.preview_promotion(p_code text, p_subtotal numeric)` RPC returning `table(valid boolean, reason text, discount_amount numeric, promotion_id uuid, title text)`.

- [ ] **Step 1: Write the migration**

```sql
begin;

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  title text not null,
  description text,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value numeric(12,2) not null check (discount_value > 0),
  max_discount_amount numeric(12,2) check (max_discount_amount is null or max_discount_amount > 0),
  min_subtotal numeric(12,2) not null default 0 check (min_subtotal >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default true,
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  per_customer_limit integer not null default 1 check (per_customer_limit > 0),
  current_uses integer not null default 0 check (current_uses >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_code_unique unique (code),
  constraint promotions_date_window_valid check (ends_at > starts_at),
  constraint promotions_percentage_bounded check (
    discount_type <> 'percentage' or discount_value <= 100
  )
);

create index promotions_active_window_idx
  on public.promotions (is_active, starts_at, ends_at);

alter table public.promotions enable row level security;

create policy admins_manage_promotions
on public.promotions for all
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

revoke all on table public.promotions from anon, authenticated;
grant select, insert, update on table public.promotions to authenticated;
grant all on table public.promotions to service_role;

create table public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  customer_id uuid references auth.users(id) on delete set null,
  discount_amount numeric(12,2) not null check (discount_amount >= 0),
  created_at timestamptz not null default now(),
  constraint promotion_redemptions_booking_unique unique (booking_id)
);

create index promotion_redemptions_promotion_customer_idx
  on public.promotion_redemptions (promotion_id, customer_id);

alter table public.promotion_redemptions enable row level security;

create policy admins_read_promotion_redemptions
on public.promotion_redemptions for select
to authenticated
using ((select private.is_admin()));

revoke all on table public.promotion_redemptions from anon, authenticated;
grant select on table public.promotion_redemptions to authenticated;
grant all on table public.promotion_redemptions to service_role;

-- Safe public read surface: only currently-active, in-window promotions,
-- and only the columns a storefront banner or checkout preview needs.
-- Runs with the view owner's privileges (no security_invoker), so it
-- intentionally bypasses the admin-only RLS above for these columns only.
create view public.active_promotions as
select id, code, title, description, discount_type, discount_value,
  max_discount_amount, min_subtotal, ends_at
from public.promotions
where is_active = true
  and now() >= starts_at
  and now() <= ends_at;

grant select on public.active_promotions to anon, authenticated;

create or replace function public.preview_promotion(p_code text, p_subtotal numeric)
returns table (valid boolean, reason text, discount_amount numeric, promotion_id uuid, title text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_promo public.promotions;
  v_base numeric;
  v_discount numeric := 0;
  v_uid uuid;
  v_customer_uses integer := 0;
begin
  v_code := upper(trim(coalesce(p_code, '')));
  v_base := greatest(coalesce(p_subtotal, 0), 0);
  v_uid := auth.uid();

  if v_code = '' then
    return query select false, 'INVALID_CODE', 0::numeric, null::uuid, null::text;
    return;
  end if;

  select p.* into v_promo from public.promotions p where upper(p.code) = v_code;

  if v_promo.id is null then
    return query select false, 'NOT_FOUND', 0::numeric, null::uuid, null::text;
    return;
  end if;
  if not v_promo.is_active then
    return query select false, 'INACTIVE', 0::numeric, v_promo.id, v_promo.title;
    return;
  end if;
  if now() < v_promo.starts_at then
    return query select false, 'NOT_STARTED', 0::numeric, v_promo.id, v_promo.title;
    return;
  end if;
  if now() > v_promo.ends_at then
    return query select false, 'EXPIRED', 0::numeric, v_promo.id, v_promo.title;
    return;
  end if;
  if v_base < v_promo.min_subtotal then
    return query select false, 'MIN_SUBTOTAL_NOT_MET', 0::numeric, v_promo.id, v_promo.title;
    return;
  end if;
  if v_promo.usage_limit is not null and v_promo.current_uses >= v_promo.usage_limit then
    return query select false, 'USAGE_LIMIT_REACHED', 0::numeric, v_promo.id, v_promo.title;
    return;
  end if;

  if v_uid is not null then
    select count(*)::integer into v_customer_uses
    from public.promotion_redemptions r
    where r.promotion_id = v_promo.id and r.customer_id = v_uid;
    if v_customer_uses >= v_promo.per_customer_limit then
      return query select false, 'CUSTOMER_LIMIT_REACHED', 0::numeric, v_promo.id, v_promo.title;
      return;
    end if;
  end if;

  if v_promo.discount_type = 'percentage' then
    v_discount := round(v_base * v_promo.discount_value / 100, 2);
    if v_promo.max_discount_amount is not null then
      v_discount := least(v_discount, v_promo.max_discount_amount);
    end if;
  else
    v_discount := v_promo.discount_value;
  end if;
  v_discount := least(v_discount, v_base);

  return query select true, null::text, v_discount, v_promo.id, v_promo.title;
end;
$$;

revoke all on function public.preview_promotion(text, numeric) from public;
grant execute on function public.preview_promotion(text, numeric) to anon, authenticated;

commit;
```

- [ ] **Step 2: Write the pure-logic regression test**

Discount math (percentage cap, fixed cap at subtotal) is simple enough to also pin client-side so a future refactor of the mirrored TypeScript preview logic (Task 7) can't silently diverge from this SQL. This test only checks the SQL file's text for the invariants that matter — it cannot run the migration locally (no local Postgres in this repo's test setup), so it is a guardrail against accidentally deleting the caps, not a behavioral test.

```typescript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20260929090000_promotions_schema.sql"),
  "utf8",
);

test("percentage promotions are capped at 100%", () => {
  assert.match(sql, /discount_value <= 100/);
});

test("preview_promotion caps the discount at the subtotal", () => {
  assert.match(sql, /v_discount := least\(v_discount, v_base\);/);
});

test("preview_promotion checks the date window before returning valid", () => {
  assert.match(sql, /now\(\) < v_promo\.starts_at/);
  assert.match(sql, /now\(\) > v_promo\.ends_at/);
});

test("promotion_redemptions enforces one redemption per booking", () => {
  assert.match(sql, /constraint promotion_redemptions_booking_unique unique \(booking_id\)/);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx --test scripts/testPromotions.ts`
Expected: FAIL with "Cannot find module" (file doesn't exist yet) — write the migration file (Step 1) first if you haven't, then re-run; it should PASS once Step 1's file exists with the exact text above.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test scripts/testPromotions.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Show the user the migration SQL and ask for confirmation, then apply it**

Show the full SQL from Step 1. Only after the user explicitly confirms, run:
`npx supabase db push` (or the project's established push command — check `supabase/config.toml` / prior session notes for the linked project ref first).

- [ ] **Step 6: Regenerate types and commit**

```bash
npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
git add supabase/migrations/20260929090000_promotions_schema.sql scripts/testPromotions.ts src/lib/supabase/database.types.ts
git commit -m "feat: add promotions schema with public preview RPC"
```

---

## Task 2: Promotion redemption RPC and booking totals integration

**Files:**
- Create: `supabase/migrations/20260929091000_redeem_promotion.sql`
- Modify: `scripts/testPromotions.ts`

**Interfaces:**
- Consumes: `public.promotions`, `public.promotion_redemptions` from Task 1; existing `public.booking_totals` view shape (`booking_id, rental_days, rental_subtotal, deposit_total, delivery_fee, total_amount, special_discount_total, pickup_convenience_fee` — latest version, from `supabase/migrations/20260812070320_time_based_unit_availability.sql` lines 547-581); existing `bookings.birthday_discount_amount` / `bookings.loyalty_discount_amount` / `bookings.is_guest_checkout` / `bookings.customer_id`.
- Produces: `bookings.promotion_id`, `bookings.promotion_code_snapshot`, `bookings.promotion_discount_amount` columns; `public.redeem_promotion(p_booking_id uuid, p_code text)` RPC returning `numeric` (discount applied); extended `public.booking_totals` view with `promotion_discount_amount` and `promotion_code` columns, `total_amount` now also subtracts `promotion_discount_amount`.

- [ ] **Step 1: Write the migration**

```sql
begin;

alter table public.bookings
  add column promotion_id uuid references public.promotions(id) on delete set null,
  add column promotion_code_snapshot text,
  add column promotion_discount_amount numeric(12,2) not null default 0
    check (promotion_discount_amount >= 0);

create or replace function public.redeem_promotion(p_booking_id uuid, p_code text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_booking public.bookings;
  v_code text;
  v_promo public.promotions;
  v_base numeric;
  v_discount numeric;
  v_customer_uses integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_booking from public.bookings
  where id = p_booking_id and customer_id = v_uid
  for update;

  if v_booking.id is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if v_booking.is_guest_checkout then
    raise exception 'GUEST_NOT_ELIGIBLE';
  end if;
  if v_booking.promotion_id is not null then
    raise exception 'PROMOTION_ALREADY_APPLIED';
  end if;

  v_code := upper(trim(coalesce(p_code, '')));
  if v_code = '' then
    raise exception 'INVALID_CODE';
  end if;

  select * into v_promo from public.promotions where upper(code) = v_code for update;
  if v_promo.id is null then
    raise exception 'PROMOTION_NOT_FOUND';
  end if;
  if not v_promo.is_active then
    raise exception 'PROMOTION_INACTIVE';
  end if;
  if now() < v_promo.starts_at then
    raise exception 'PROMOTION_NOT_STARTED';
  end if;
  if now() > v_promo.ends_at then
    raise exception 'PROMOTION_EXPIRED';
  end if;

  select greatest(bt.rental_subtotal - v_booking.birthday_discount_amount - v_booking.loyalty_discount_amount, 0)
    into v_base
  from public.booking_totals bt
  where bt.booking_id = v_booking.id;

  if v_base < v_promo.min_subtotal then
    raise exception 'MIN_SUBTOTAL_NOT_MET';
  end if;
  if v_promo.usage_limit is not null and v_promo.current_uses >= v_promo.usage_limit then
    raise exception 'USAGE_LIMIT_REACHED';
  end if;

  select count(*)::integer into v_customer_uses
  from public.promotion_redemptions
  where promotion_id = v_promo.id and customer_id = v_uid;
  if v_customer_uses >= v_promo.per_customer_limit then
    raise exception 'CUSTOMER_LIMIT_REACHED';
  end if;

  if v_promo.discount_type = 'percentage' then
    v_discount := round(v_base * v_promo.discount_value / 100, 2);
    if v_promo.max_discount_amount is not null then
      v_discount := least(v_discount, v_promo.max_discount_amount);
    end if;
  else
    v_discount := v_promo.discount_value;
  end if;
  v_discount := least(v_discount, v_base);

  update public.bookings
  set promotion_id = v_promo.id,
      promotion_code_snapshot = v_promo.code,
      promotion_discount_amount = v_discount
  where id = v_booking.id;

  insert into public.promotion_redemptions (promotion_id, booking_id, customer_id, discount_amount)
  values (v_promo.id, v_booking.id, v_uid, v_discount);

  update public.promotions
  set current_uses = current_uses + 1, updated_at = now()
  where id = v_promo.id;

  perform private.log_audit_event(
    'promotion.redeemed', 'booking', v_booking.id::text, v_booking.id,
    null, jsonb_build_object('promotionId', v_promo.id, 'code', v_promo.code, 'discount', v_discount),
    'user'
  );

  return v_discount;
end;
$$;

revoke all on function public.redeem_promotion(uuid, text) from public, anon;
grant execute on function public.redeem_promotion(uuid, text) to authenticated;

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
    + coalesce(sum(bi.quantity::numeric * bi.deposit_per_unit_snapshot), 0::numeric)
    + coalesce(bf.delivery_fee_snapshot, 0::numeric)
    + coalesce(bf.pickup_convenience_fee_snapshot, 0::numeric)
    - b.birthday_discount_amount
    - b.loyalty_discount_amount
    - b.promotion_discount_amount,
    0::numeric
  )::numeric(12,2) as total_amount,
  (b.birthday_discount_amount + b.loyalty_discount_amount)::numeric(12,2)
    as special_discount_total,
  coalesce(bf.pickup_convenience_fee_snapshot, 0::numeric)::numeric(12,2)
    as pickup_convenience_fee,
  b.promotion_discount_amount::numeric(12,2) as promotion_discount_amount,
  b.promotion_code_snapshot as promotion_code
from public.bookings b
left join public.booking_items bi on bi.booking_id = b.id
left join public.booking_fulfillments bf on bf.booking_id = b.id
group by b.id, bf.delivery_fee_snapshot, bf.pickup_convenience_fee_snapshot,
  b.rental_period, b.birthday_discount_amount, b.loyalty_discount_amount,
  b.promotion_discount_amount, b.promotion_code_snapshot;

commit;
```

- [ ] **Step 2: Add regression tests to `scripts/testPromotions.ts`**

Append to the existing file from Task 1:

```typescript
test("redeem_promotion locks the booking row before checking eligibility", () => {
  const redeemSql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20260929091000_redeem_promotion.sql"),
    "utf8",
  );
  assert.match(redeemSql, /where id = p_booking_id and customer_id = v_uid\s*\n\s*for update;/);
  assert.match(redeemSql, /select \* into v_promo from public\.promotions where upper\(code\) = v_code for update;/);
});

test("redeem_promotion rejects guest checkouts and re-redemption", () => {
  const redeemSql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20260929091000_redeem_promotion.sql"),
    "utf8",
  );
  assert.match(redeemSql, /GUEST_NOT_ELIGIBLE/);
  assert.match(redeemSql, /PROMOTION_ALREADY_APPLIED/);
});

test("booking_totals subtracts the promotion discount from total_amount", () => {
  const redeemSql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20260929091000_redeem_promotion.sql"),
    "utf8",
  );
  assert.match(redeemSql, /- b\.promotion_discount_amount,\s*\n\s*0::numeric/);
});
```

- [ ] **Step 3: Run tests, verify pass**

Run: `npx tsx --test scripts/testPromotions.ts`
Expected: PASS (7 tests total)

- [ ] **Step 4: Show the user the migration SQL, confirm, apply, regenerate types, commit**

Same procedure as Task 1 Steps 5-6. Commit message: `"feat: add redeem_promotion RPC and extend booking_totals"`.

---

## Task 3: Newsletter schema and subscribe/unsubscribe RPCs

**Files:**
- Create: `supabase/migrations/20260929092000_newsletter_subscribers.sql`
- Test: `scripts/testNewsletter.ts`

**Interfaces:**
- Produces: `public.newsletter_subscribers` table (`id, email, consented_at, status ('subscribed'|'unsubscribed'), unsubscribed_at, unsubscribe_token, source, customer_id, created_at`); `public.subscribe_newsletter(p_email text, p_source text default null)` returning `table(already_subscribed boolean, unsubscribe_token uuid)`; `public.unsubscribe_newsletter(p_token uuid)` returning `boolean`.

- [ ] **Step 1: Write the migration**

```sql
begin;

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  consented_at timestamptz not null default now(),
  status text not null default 'subscribed' check (status in ('subscribed', 'unsubscribed')),
  unsubscribed_at timestamptz,
  unsubscribe_token uuid not null default gen_random_uuid(),
  source text,
  customer_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint newsletter_subscribers_email_unique unique (email)
);

create unique index newsletter_subscribers_token_idx on public.newsletter_subscribers (unsubscribe_token);

alter table public.newsletter_subscribers enable row level security;

create policy admins_read_newsletter_subscribers
on public.newsletter_subscribers for select
to authenticated
using ((select private.is_admin()));

revoke all on table public.newsletter_subscribers from anon, authenticated;
grant select on table public.newsletter_subscribers to authenticated;
grant all on table public.newsletter_subscribers to service_role;

create or replace function public.subscribe_newsletter(p_email text, p_source text default null)
returns table (already_subscribed boolean, unsubscribe_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_uid uuid;
  v_was_subscribed boolean;
  v_token uuid;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  v_uid := auth.uid();

  select (status = 'subscribed') into v_was_subscribed
  from public.newsletter_subscribers where email = v_email;

  insert into public.newsletter_subscribers (email, source, customer_id)
  values (v_email, nullif(p_source, ''), v_uid)
  on conflict (email) do update set
    status = 'subscribed',
    unsubscribed_at = null,
    consented_at = now(),
    source = coalesce(public.newsletter_subscribers.source, excluded.source),
    customer_id = coalesce(public.newsletter_subscribers.customer_id, excluded.customer_id)
  returning public.newsletter_subscribers.unsubscribe_token into v_token;

  return query select coalesce(v_was_subscribed, false), v_token;
end;
$$;

revoke all on function public.subscribe_newsletter(text, text) from public;
grant execute on function public.subscribe_newsletter(text, text) to anon, authenticated;

create or replace function public.unsubscribe_newsletter(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.newsletter_subscribers
  set status = 'unsubscribed', unsubscribed_at = now()
  where unsubscribe_token = p_token and status = 'subscribed';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.unsubscribe_newsletter(uuid) from public;
grant execute on function public.unsubscribe_newsletter(uuid) to anon, authenticated;

commit;
```

- [ ] **Step 2: Write `scripts/testNewsletter.ts`**

```typescript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20260929092000_newsletter_subscribers.sql"),
  "utf8",
);

test("subscribe_newsletter validates email format before inserting", () => {
  assert.match(sql, /INVALID_EMAIL/);
  assert.match(sql, /\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$/);
});

test("subscribe_newsletter upserts on the unique email constraint instead of erroring on duplicates", () => {
  assert.match(sql, /on conflict \(email\) do update set/);
});

test("newsletter_subscribers has no direct anon/authenticated write access", () => {
  assert.match(sql, /revoke all on table public\.newsletter_subscribers from anon, authenticated;/);
});

test("unsubscribe_newsletter only flips subscribed rows and reports whether it changed anything", () => {
  assert.match(sql, /where unsubscribe_token = p_token and status = 'subscribed';/);
  assert.match(sql, /return v_rows > 0;/);
});
```

- [ ] **Step 3: Run test, verify pass**

Run: `npx tsx --test scripts/testNewsletter.ts`
Expected: PASS (4 tests)

- [ ] **Step 4: Show the user the migration SQL, confirm, apply, regenerate types, commit**

Commit message: `"feat: add newsletter subscribe/unsubscribe schema"`.

---

## Task 4: Analytics events schema and logging RPC

**Files:**
- Create: `supabase/migrations/20260929093000_analytics_events.sql`
- Test: `scripts/testAnalyticsTrack.ts`

**Interfaces:**
- Produces: `public.analytics_events` table (`id, event_type, session_id, customer_id, is_guest, product_id, promotion_id, booking_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, metadata, created_at`); `public.log_marketing_event(p_event_type text, p_session_id text, p_product_id uuid default null, p_promotion_id uuid default null, p_booking_id uuid default null, p_metadata jsonb default '{}'::jsonb, p_utm_source text default null, p_utm_medium text default null, p_utm_campaign text default null, p_utm_term text default null, p_utm_content text default null)` returning `void`.

- [ ] **Step 1: Write the migration**

```sql
begin;

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'product_view', 'search', 'add_to_cart', 'checkout_start',
    'booking_completed', 'promotion_applied', 'newsletter_signup'
  )),
  session_id text not null,
  customer_id uuid references auth.users(id) on delete set null,
  is_guest boolean not null default false,
  product_id uuid references public.products(id) on delete set null,
  promotion_id uuid references public.promotions(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index analytics_events_type_created_idx on public.analytics_events (event_type, created_at desc);
create index analytics_events_session_idx on public.analytics_events (session_id);

alter table public.analytics_events enable row level security;

create policy admins_read_analytics_events
on public.analytics_events for select
to authenticated
using ((select private.is_admin()));

revoke all on table public.analytics_events from anon, authenticated;
grant select on table public.analytics_events to authenticated;
grant all on table public.analytics_events to service_role;

create or replace function public.log_marketing_event(
  p_event_type text,
  p_session_id text,
  p_product_id uuid default null,
  p_promotion_id uuid default null,
  p_booking_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_term text default null,
  p_utm_content text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_is_guest boolean;
  v_session_id text;
begin
  if p_event_type not in (
    'product_view', 'search', 'add_to_cart', 'checkout_start',
    'booking_completed', 'promotion_applied', 'newsletter_signup'
  ) then
    raise exception 'INVALID_EVENT_TYPE';
  end if;

  v_session_id := nullif(trim(coalesce(p_session_id, '')), '');
  if v_session_id is null then
    raise exception 'SESSION_ID_REQUIRED';
  end if;

  v_uid := auth.uid();
  select coalesce(u.is_anonymous, v_uid is null) into v_is_guest
  from auth.users u where u.id = v_uid;
  v_is_guest := coalesce(v_is_guest, true);

  insert into public.analytics_events (
    event_type, session_id, customer_id, is_guest, product_id, promotion_id,
    booking_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, metadata
  )
  values (
    p_event_type, left(v_session_id, 100), v_uid, v_is_guest, p_product_id, p_promotion_id,
    p_booking_id, nullif(p_utm_source, ''), nullif(p_utm_medium, ''), nullif(p_utm_campaign, ''),
    nullif(p_utm_term, ''), nullif(p_utm_content, ''), coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.log_marketing_event(
  text, text, uuid, uuid, uuid, jsonb, text, text, text, text, text
) from public;
grant execute on function public.log_marketing_event(
  text, text, uuid, uuid, uuid, jsonb, text, text, text, text, text
) to anon, authenticated;

commit;
```

- [ ] **Step 2: Write `scripts/testAnalyticsTrack.ts`**

```typescript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20260929093000_analytics_events.sql"),
  "utf8",
);

test("log_marketing_event rejects an event_type outside the allow-list", () => {
  assert.match(sql, /if p_event_type not in \(/);
  assert.match(sql, /raise exception 'INVALID_EVENT_TYPE';/);
});

test("analytics_events has no direct anon/authenticated write access (insert-only via RPC)", () => {
  assert.match(sql, /revoke all on table public\.analytics_events from anon, authenticated;/);
  assert.match(sql, /grant select on table public\.analytics_events to authenticated;/);
});

test("customer identity comes from auth.uid(), never a client-supplied parameter", () => {
  assert.doesNotMatch(sql, /p_customer_id/);
  assert.match(sql, /v_uid := auth\.uid\(\);/);
});

test("the same seven event types are allowed in both the table check constraint and the RPC guard", () => {
  const eventList = "'product_view', 'search', 'add_to_cart', 'checkout_start',\n    'booking_completed', 'promotion_applied', 'newsletter_signup'";
  const occurrences = sql.split(eventList).length - 1;
  assert.equal(occurrences, 2);
});
```

- [ ] **Step 3: Run test, verify pass**

Run: `npx tsx --test scripts/testAnalyticsTrack.ts`
Expected: PASS (4 tests)

- [ ] **Step 4: Show the user the migration SQL, confirm, apply, regenerate types, commit**

Commit message: `"feat: add first-party analytics_events schema and log_marketing_event RPC"`.

---

## Task 5: Admin promotions API routes

**Files:**
- Create: `app/api/admin/promotions/route.ts`, `app/api/admin/promotions/[id]/route.ts`

**Interfaces:**
- Consumes: `requireActiveAdmin()`, `enforceRateLimit()`, `RequestSecurityError` from `src/lib/server/requestSecurity.ts` (pattern: `app/api/admin/catalog/route.ts`); `public.promotions`, `public.promotion_redemptions` from Task 1.
- Produces: `GET /api/admin/promotions` → `{ promotions: PromotionAdminRow[] }` where each row includes `redemptionCount` and a derived `status: "scheduled"|"active"|"expired"|"inactive"`; `POST /api/admin/promotions` → `{ success: true, promotionId }`; `PATCH /api/admin/promotions/[id]` → `{ success: true }` (accepts partial updates incl. `is_active` toggle and date rescheduling); consumed by Task 6's UI.

- [ ] **Step 1: Write `app/api/admin/promotions/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";

function deriveStatus(promo: { is_active: boolean; starts_at: string; ends_at: string }): string {
  if (!promo.is_active) return "inactive";
  const now = Date.now();
  if (now < new Date(promo.starts_at).getTime()) return "scheduled";
  if (now > new Date(promo.ends_at).getTime()) return "expired";
  return "active";
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-promotions-read", 60, 60_000);
    const { supabase } = await requireActiveAdmin();

    const [promotionsResult, redemptionsResult] = await Promise.all([
      supabase.from("promotions").select("*").order("created_at", { ascending: false }),
      supabase.from("promotion_redemptions").select("promotion_id, discount_amount"),
    ]);
    if (promotionsResult.error) throw new Error(promotionsResult.error.message);
    if (redemptionsResult.error) throw new Error(redemptionsResult.error.message);

    const redemptionsByPromotion = new Map<string, { count: number; totalDiscount: number }>();
    for (const row of redemptionsResult.data ?? []) {
      const existing = redemptionsByPromotion.get(row.promotion_id) ?? { count: 0, totalDiscount: 0 };
      existing.count += 1;
      existing.totalDiscount += Number(row.discount_amount);
      redemptionsByPromotion.set(row.promotion_id, existing);
    }

    const promotions = (promotionsResult.data ?? []).map((promo) => ({
      ...promo,
      status: deriveStatus(promo),
      redemptionCount: redemptionsByPromotion.get(promo.id)?.count ?? 0,
      totalDiscountGiven: redemptionsByPromotion.get(promo.id)?.totalDiscount ?? 0,
    }));

    return NextResponse.json({ promotions });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin promotions read failed", error);
    return NextResponse.json({ error: "Promotions could not be loaded." }, { status: 500 });
  }
}

interface CreatePromotionInput {
  code: string;
  title: string;
  description?: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  maxDiscountAmount?: number | null;
  minSubtotal?: number;
  startsAt: string;
  endsAt: string;
  usageLimit?: number | null;
  perCustomerLimit?: number;
}

function parseCreateInput(body: unknown): CreatePromotionInput {
  if (!body || typeof body !== "object") throw new Error("INVALID_PROMOTION_INPUT");
  const input = body as Record<string, unknown>;
  const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const discountType = input.discountType === "fixed" ? "fixed" : input.discountType === "percentage" ? "percentage" : null;
  const discountValue = Number(input.discountValue);
  const startsAt = typeof input.startsAt === "string" ? input.startsAt : "";
  const endsAt = typeof input.endsAt === "string" ? input.endsAt : "";

  if (!code || !title || !discountType || !Number.isFinite(discountValue) || discountValue <= 0 || !startsAt || !endsAt) {
    throw new Error("INVALID_PROMOTION_INPUT");
  }
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    throw new Error("INVALID_PROMOTION_INPUT");
  }

  return {
    code,
    title,
    description: typeof input.description === "string" ? input.description.trim() || undefined : undefined,
    discountType,
    discountValue,
    maxDiscountAmount: Number.isFinite(Number(input.maxDiscountAmount)) ? Number(input.maxDiscountAmount) : null,
    minSubtotal: Number.isFinite(Number(input.minSubtotal)) ? Number(input.minSubtotal) : 0,
    startsAt,
    endsAt,
    usageLimit: Number.isFinite(Number(input.usageLimit)) && Number(input.usageLimit) > 0 ? Number(input.usageLimit) : null,
    perCustomerLimit: Number.isFinite(Number(input.perCustomerLimit)) && Number(input.perCustomerLimit) > 0 ? Number(input.perCustomerLimit) : 1,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-promotions-write", 20, 60_000);
    const { supabase, user } = await requireActiveAdmin();
    const input = parseCreateInput(await request.json());

    const { data, error } = await supabase
      .from("promotions")
      .insert({
        code: input.code,
        title: input.title,
        description: input.description ?? null,
        discount_type: input.discountType,
        discount_value: input.discountValue,
        max_discount_amount: input.maxDiscountAmount,
        min_subtotal: input.minSubtotal,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        usage_limit: input.usageLimit,
        per_customer_limit: input.perCustomerLimit,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        return NextResponse.json({ error: "A promotion with this code already exists." }, { status: 409 });
      }
      throw new Error(error?.message ?? "Promotion could not be created.");
    }

    return NextResponse.json({ success: true, promotionId: data.id }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message === "INVALID_PROMOTION_INPUT") {
      return NextResponse.json({ error: "Check the promotion details and try again." }, { status: 400 });
    }
    console.error("Admin promotion creation failed", error);
    return NextResponse.json({ error: "The promotion could not be created." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write `app/api/admin/promotions/[id]/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-promotions-write", 20, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    if (typeof body.isActive === "boolean") patch.is_active = body.isActive;
    if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
    if (typeof body.description === "string") patch.description = body.description.trim() || null;
    if (typeof body.startsAt === "string") patch.starts_at = body.startsAt;
    if (typeof body.endsAt === "string") patch.ends_at = body.endsAt;
    if (Number.isFinite(Number(body.usageLimit))) patch.usage_limit = Number(body.usageLimit);
    if (body.usageLimit === null) patch.usage_limit = null;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No changes provided." }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    const { error } = await supabase.from("promotions").update(patch).eq("id", id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin promotion update failed", error);
    return NextResponse.json({ error: "The promotion could not be updated." }, { status: 500 });
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from these two files.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/promotions
git commit -m "feat: add admin promotions CRUD API routes"
```

---

## Task 6: Admin Marketing UI — Promotions tab

**Files:**
- Create: `app/admin/marketing/page.tsx`, `components/admin/AdminMarketingManager.tsx`, `components/admin/AdminMarketingManager.module.css`
- Modify: `components/admin/AdminShell.tsx:20-27` (add a "Marketing" nav section)

**Interfaces:**
- Consumes: `GET/POST /api/admin/promotions`, `PATCH /api/admin/promotions/[id]` from Task 5.
- Produces: `AdminMarketingManager` client component with an internal `activeTab` state (`"promotions" | "subscribers" | "metrics"`) — Tasks 11 and 13 add the other two tabs into this same file/component rather than creating new pages.

- [ ] **Step 1: Add the nav link**

In `components/admin/AdminShell.tsx`, insert a new section into `navSections` (after `"Rental Management"`, matching the existing array-of-objects shape at lines 20-27):

```typescript
  {
    title: "Marketing",
    items: [{ href: "/admin/marketing", label: "Promotions & Marketing" }],
  },
```

- [ ] **Step 2: Write `app/admin/marketing/page.tsx`**

```typescript
import type { Metadata } from "next";
import AdminMarketingManager from "@/components/admin/AdminMarketingManager";
import AdminShell from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Marketing | Rental by Maddy & Cassy Admin",
  description: "Manage promotions, newsletter subscribers, and marketing conversion metrics.",
};

export default function AdminMarketingPage() {
  return (
    <AdminShell>
      <AdminMarketingManager />
    </AdminShell>
  );
}
```

- [ ] **Step 3: Write `components/admin/AdminMarketingManager.tsx`**

Follow the exact pattern in `components/admin/AdminCatalogManager.tsx` (already read in full during planning): plain `useState` for every piece of fetched data, `fetch()` calls to the API routes, plain `<form onSubmit>` with controlled inputs, plain `<table>`. Implement only the Promotions tab in this task (a tab bar with all three tab labels, but Subscribers/Metrics render a `"Coming soon"` placeholder `<p>` until Tasks 11 and 13 replace it):

```typescript
"use client";

import { useEffect, useState } from "react";
import styles from "./AdminMarketingManager.module.css";

interface PromotionRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  max_discount_amount: number | null;
  min_subtotal: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  usage_limit: number | null;
  per_customer_limit: number;
  current_uses: number;
  status: "scheduled" | "active" | "expired" | "inactive";
  redemptionCount: number;
  totalDiscountGiven: number;
}

const emptyForm = {
  code: "",
  title: "",
  description: "",
  discountType: "fixed" as "fixed" | "percentage",
  discountValue: "",
  maxDiscountAmount: "",
  minSubtotal: "0",
  startsAt: "",
  endsAt: "",
  usageLimit: "",
  perCustomerLimit: "1",
};

function money(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminMarketingManager() {
  const [activeTab, setActiveTab] = useState<"promotions" | "subscribers" | "metrics">("promotions");
  const [promotions, setPromotions] = useState<PromotionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadPromotions() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/promotions");
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Promotions could not be loaded.");
      setPromotions(body.promotions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Promotions could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPromotions();
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setFormError(null);
    try {
      const response = await fetch("/api/admin/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          title: form.title,
          description: form.description,
          discountType: form.discountType,
          discountValue: Number(form.discountValue),
          maxDiscountAmount: form.maxDiscountAmount ? Number(form.maxDiscountAmount) : null,
          minSubtotal: Number(form.minSubtotal || 0),
          startsAt: form.startsAt,
          endsAt: form.endsAt,
          usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
          perCustomerLimit: Number(form.perCustomerLimit || 1),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "The promotion could not be created.");
      setForm(emptyForm);
      await loadPromotions();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "The promotion could not be created.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(promotion: PromotionRow) {
    try {
      const response = await fetch(`/api/admin/promotions/${promotion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !promotion.is_active }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "The promotion could not be updated.");
      }
      await loadPromotions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The promotion could not be updated.");
    }
  }

  return (
    <div className={styles.wrapper}>
      <h1 className={styles.heading}>Marketing</h1>
      <div className={styles.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={activeTab === "promotions"} className={activeTab === "promotions" ? styles.tabActive : styles.tab} onClick={() => setActiveTab("promotions")}>
          Promotions
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "subscribers"} className={activeTab === "subscribers" ? styles.tabActive : styles.tab} onClick={() => setActiveTab("subscribers")}>
          Subscribers
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "metrics"} className={activeTab === "metrics" ? styles.tabActive : styles.tab} onClick={() => setActiveTab("metrics")}>
          Metrics
        </button>
      </div>

      {activeTab === "promotions" ? (
        <>
          <form className={styles.form} onSubmit={handleCreate}>
            <h2 className={styles.sectionHeading}>Create a promotion</h2>
            <div className={styles.formRow}>
              <label>
                Code
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required maxLength={32} />
              </label>
              <label>
                Title
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={120} />
              </label>
            </div>
            <label className={styles.fullWidth}>
              Description
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} />
            </label>
            <div className={styles.formRow}>
              <label>
                Discount type
                <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as "fixed" | "percentage" })}>
                  <option value="fixed">Fixed amount (PHP)</option>
                  <option value="percentage">Percentage</option>
                </select>
              </label>
              <label>
                Discount value
                <input type="number" min="0" step="0.01" value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} required />
              </label>
              {form.discountType === "percentage" ? (
                <label>
                  Max discount (PHP, optional cap)
                  <input type="number" min="0" step="0.01" value={form.maxDiscountAmount} onChange={(e) => setForm({ ...form, maxDiscountAmount: e.target.value })} />
                </label>
              ) : null}
            </div>
            <div className={styles.formRow}>
              <label>
                Minimum subtotal (PHP)
                <input type="number" min="0" step="0.01" value={form.minSubtotal} onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })} />
              </label>
              <label>
                Usage limit (optional)
                <input type="number" min="1" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} />
              </label>
              <label>
                Per-customer limit
                <input type="number" min="1" value={form.perCustomerLimit} onChange={(e) => setForm({ ...form, perCustomerLimit: e.target.value })} />
              </label>
            </div>
            <div className={styles.formRow}>
              <label>
                Starts
                <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} required />
              </label>
              <label>
                Ends
                <input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} required />
              </label>
            </div>
            {formError ? <p className={styles.error} role="alert">{formError}</p> : null}
            <button type="submit" disabled={creating} className={styles.submitButton}>
              {creating ? "Creating…" : "Create promotion"}
            </button>
          </form>

          <h2 className={styles.sectionHeading}>Active &amp; scheduled promotions</h2>
          {loading ? (
            <p className={styles.loading}>Loading promotions…</p>
          ) : error ? (
            <p className={styles.error} role="alert">{error}</p>
          ) : promotions.length === 0 ? (
            <p className={styles.empty}>No promotions yet. Create one above.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Title</th>
                  <th>Discount</th>
                  <th>Window</th>
                  <th>Status</th>
                  <th>Uses</th>
                  <th>Discount given</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((promo) => (
                  <tr key={promo.id}>
                    <td>{promo.code}</td>
                    <td>{promo.title}</td>
                    <td>{promo.discount_type === "percentage" ? `${promo.discount_value}%` : money(promo.discount_value)}</td>
                    <td>{new Date(promo.starts_at).toLocaleDateString()} – {new Date(promo.ends_at).toLocaleDateString()}</td>
                    <td><span className={styles[`status_${promo.status}`]}>{promo.status}</span></td>
                    <td>{promo.redemptionCount}{promo.usage_limit ? ` / ${promo.usage_limit}` : ""}</td>
                    <td>{money(promo.totalDiscountGiven)}</td>
                    <td>
                      <button type="button" className={styles.linkButton} onClick={() => toggleActive(promo)}>
                        {promo.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : activeTab === "subscribers" ? (
        <p className={styles.empty}>Coming soon.</p>
      ) : (
        <p className={styles.empty}>Coming soon.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write `components/admin/AdminMarketingManager.module.css`**

Match the pink/cream editorial tokens already used by `AdminCatalogManager`'s stylesheet — read `components/admin/AdminCatalogManager.module.css` first and reuse its existing `--` custom properties (table borders, button colors, status-pill colors) rather than inventing new ones. Add `.status_active`, `.status_scheduled`, `.status_expired`, `.status_inactive` pill variants (green/blue/gray/gray, consistent with any existing status-pill color convention found in that file or in `components/admin/AdminBookingDetail`'s status styling).

- [ ] **Step 5: Typecheck and manually verify**

Run: `npx tsc --noEmit`. Then start the dev server (`npm run dev`), sign in as an admin, visit `/admin/marketing`, create a test promotion, confirm it appears with status "scheduled" or "active" depending on the dates chosen, and toggle it inactive/active.

- [ ] **Step 6: Commit**

```bash
git add app/admin/marketing components/admin/AdminMarketingManager.tsx components/admin/AdminMarketingManager.module.css components/admin/AdminShell.tsx
git commit -m "feat: add admin marketing promotions management UI"
```

---

## Task 7: Public promotion validation API and storefront banner

**Files:**
- Create: `app/api/promotions/validate/route.ts`, `app/api/promotions/active/route.ts`, `components/promotions/ActivePromotionsBanner.tsx`, `components/promotions/ActivePromotionsBanner.module.css`
- Modify: `app/catalog/page.tsx` (render banner above the grid), `app/cart/CartView.tsx` (render banner above cart contents)

**Interfaces:**
- Consumes: `public.preview_promotion` RPC (Task 1), `public.active_promotions` view (Task 1), `requireUser()`/rate limiting pattern from `src/lib/server/requestSecurity.ts`.
- Produces: `POST /api/promotions/validate` → `{ valid: boolean; reason?: string; discountAmount: number; promotionId?: string; title?: string }`; `GET /api/promotions/active` → `{ promotions: { id, code, title, description, discountType, discountValue, maxDiscountAmount, minSubtotal, endsAt }[] }`; `<ActivePromotionsBanner />` component consumed by Tasks 8/9 (checkout) in addition to catalog/cart here.

- [ ] **Step 1: Write `app/api/promotions/active/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/src/lib/supabase/server";
import { enforceRateLimit } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "promotions-active-read", 60, 60_000);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("active_promotions")
      .select("id, code, title, description, discount_type, discount_value, max_discount_amount, min_subtotal, ends_at")
      .order("ends_at", { ascending: true });
    if (error) throw new Error(error.message);

    const promotions = (data ?? []).map((promo) => ({
      id: promo.id,
      code: promo.code,
      title: promo.title,
      description: promo.description,
      discountType: promo.discount_type,
      discountValue: promo.discount_value,
      maxDiscountAmount: promo.max_discount_amount,
      minSubtotal: promo.min_subtotal,
      endsAt: promo.ends_at,
    }));

    return NextResponse.json({ promotions });
  } catch (error) {
    console.error("Active promotions read failed", error);
    return NextResponse.json({ promotions: [] });
  }
}
```

- [ ] **Step 2: Write `app/api/promotions/validate/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/src/lib/supabase/server";
import { enforceRateLimit } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "promotions-validate", 20, 60_000);
    const body = (await request.json()) as { code?: unknown; subtotal?: unknown };
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const subtotal = Number(body.subtotal);
    if (!code || !Number.isFinite(subtotal)) {
      return NextResponse.json({ valid: false, reason: "INVALID_CODE", discountAmount: 0 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("preview_promotion", { p_code: code, p_subtotal: Math.max(0, subtotal) })
      .single();
    if (error || !data) throw new Error(error?.message ?? "Promotion could not be validated.");

    return NextResponse.json({
      valid: data.valid,
      reason: data.reason ?? undefined,
      discountAmount: Number(data.discount_amount ?? 0),
      promotionId: data.promotion_id ?? undefined,
      title: data.title ?? undefined,
    });
  } catch (error) {
    console.error("Promotion validation failed", error);
    return NextResponse.json({ valid: false, reason: "SERVER_ERROR", discountAmount: 0 }, { status: 500 });
  }
}
```

- [ ] **Step 3: Write `components/promotions/ActivePromotionsBanner.tsx`**

Dismissible per-day, per-promotion via `localStorage` (a per-viewer convenience only — never load-bearing state), renders nothing while loading or if there is nothing to show:

```typescript
"use client";

import { useEffect, useState } from "react";
import styles from "./ActivePromotionsBanner.module.css";

interface ActivePromotion {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discountType: "percentage" | "fixed";
  discountValue: number;
  maxDiscountAmount: number | null;
  minSubtotal: number;
  endsAt: string;
}

function dismissKey(promotionId: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `maddy-cassy-promo-dismissed:${promotionId}:${today}`;
}

function formatDiscount(promo: ActivePromotion): string {
  return promo.discountType === "percentage" ? `${promo.discountValue}% off` : `PHP ${promo.discountValue.toLocaleString("en-PH")} off`;
}

export default function ActivePromotionsBanner() {
  const [promotions, setPromotions] = useState<ActivePromotion[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/promotions/active")
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setPromotions(body.promotions ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function handleDismiss(promotionId: string) {
    try {
      window.localStorage.setItem(dismissKey(promotionId), "1");
    } catch {
      // Best-effort only; the banner just won't stay dismissed across reloads.
    }
    setDismissed((prev) => new Set(prev).add(promotionId));
  }

  const visible = promotions.filter((promo) => {
    if (dismissed.has(promo.id)) return false;
    try {
      return window.localStorage.getItem(dismissKey(promo.id)) !== "1";
    } catch {
      return true;
    }
  });

  if (visible.length === 0) return null;

  return (
    <div className={styles.banner} role="region" aria-label="Active promotions">
      {visible.map((promo) => (
        <div key={promo.id} className={styles.item}>
          <span className={styles.badge}>{formatDiscount(promo)}</span>
          <p>
            <strong>{promo.title}</strong>
            {promo.description ? <span> — {promo.description}</span> : null}
            {" "}Use code <strong>{promo.code}</strong> at checkout
            {promo.minSubtotal > 0 ? ` on orders over PHP ${promo.minSubtotal.toLocaleString("en-PH")}` : ""}.
          </p>
          <button type="button" className={styles.dismiss} aria-label="Dismiss promotion" onClick={() => handleDismiss(promo.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write `ActivePromotionsBanner.module.css`**

Read `components/footer/SiteFooter.module.css` or `app/page.module.css` first for the existing pink/cream tokens (accent color, border-radius scale, spacing scale) and reuse them — a slim single-row strip with a rounded pill badge, not a full card, so it doesn't compete visually with primary CTAs.

- [ ] **Step 5: Wire into catalog and cart pages**

In `app/catalog/page.tsx`, import and render `<ActivePromotionsBanner />` immediately above the product grid (read the file first to find the exact insertion point relative to its existing layout wrapper). In `app/cart/CartView.tsx`, render it above the cart line items, in the same place.

- [ ] **Step 6: Typecheck and manually verify**

Run: `npx tsc --noEmit`. With a test promotion active (from Task 6), visit `/catalog` and `/cart` and confirm the banner renders with the correct code/discount text, and that dismissing it hides it until the next day.

- [ ] **Step 7: Commit**

```bash
git add app/api/promotions components/promotions app/catalog/page.tsx app/cart/CartView.tsx
git commit -m "feat: add public promotion validation API and storefront banner"
```

---

## Task 8: Checkout promo code — single-item reserve flow

**Files:**
- Modify: `components/reservation/StepPaymentSubmission.tsx` (promo code input + summary line), `app/catalog/[id]/reserve/ReserveFlowClient.tsx:370-385` (redeem call after booking creation)

**Interfaces:**
- Consumes: `POST /api/promotions/validate` (Task 7), `public.redeem_promotion` RPC (Task 2, called via `supabase.rpc("redeem_promotion", { p_booking_id, p_code })`).
- Produces: a `promoCode` + `appliedPromo: { discountAmount: number; title: string } | null` local state pair in `ReserveFlowClient.tsx`, passed down as new props to `StepPaymentSubmission`.

- [ ] **Step 1: Add promo code state and a `redeemPromotion` call to `ReserveFlowClient.tsx`**

Read the full file first (it was partially read during planning — lines 1-360 need a full read before editing) to find where `draft`, `isGuest`, and other step-4 state live, then:

1. Add `const [promoCode, setPromoCode] = useState("");` and `const [appliedPromo, setAppliedPromo] = useState<{ discountAmount: number; title: string } | null>(null);` near the other `useState` declarations.
2. In `handleManualPaymentContinue` (the function shown during planning at lines 370-411), immediately after the existing block that sets `activeBookingId`/`activeBookingNumber` (right after `setBookingNumber(activeBookingId);`... actually after `setBookingNumber(activeBookingNumber);` at line 384), insert:

```typescript
      if (promoCode.trim() && !appliedPromo) {
        try {
          const { data: discountApplied, error: redeemError } = await createClient()
            .rpc("redeem_promotion", { p_booking_id: activeBookingId, p_code: promoCode.trim() });
          if (redeemError) throw redeemError;
          setAppliedPromo({ discountAmount: Number(discountApplied ?? 0), title: promoCode.trim().toUpperCase() });
          void track("promotion_applied", { bookingId: activeBookingId });
        } catch (redeemError) {
          // Non-fatal, mirrors the existing signed-agreement-PDF pattern:
          // the booking must not be blocked by a promo code failing to redeem.
          console.warn("Promo code could not be applied", redeemError);
          showToast(
            redeemError instanceof Error && redeemError.message
              ? friendlyMessage(redeemError.message, "info")
              : "That promo code could not be applied to this booking.",
            "info",
          );
        }
      }
```

(Use whatever `supabase` client variable is already in scope at that point in the function — the planning read showed a local `const supabase = createClient();` a few lines above; reuse that instance instead of creating a second one. Check `friendlyMessage`'s exact export signature in this file before calling it — it's already imported and used a few lines below for error handling.)

3. Pass `promoCode`, `onPromoCodeChange={setPromoCode}`, and `appliedPromo` as new props into the `<StepPaymentSubmission ... />` JSX call site.

- [ ] **Step 2: Add the promo code UI to `StepPaymentSubmission.tsx`**

Add to `StepPaymentSubmissionProps` (after `bookingNumber?: string;` at line 53):

```typescript
  promoCode: string;
  onPromoCodeChange: (value: string) => void;
  appliedPromo: { discountAmount: number; title: string } | null;
```

Destructure them in the component signature. Insert a small promo-code row in the Payment Summary section, right before the `<div className={styles.finalAmount}>` block (line 275), and adjust the final/due-now math to subtract the applied discount:

```tsx
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="promo-code">Promo code (optional)</label>
          <input
            id="promo-code"
            className={formStyles.input}
            value={promoCode}
            onChange={(e) => onPromoCodeChange(e.target.value.toUpperCase())}
            disabled={opening || Boolean(appliedPromo)}
            placeholder="Enter a code"
            maxLength={32}
          />
          <small>
            {appliedPromo
              ? `"${appliedPromo.title}" applied — ${money(appliedPromo.discountAmount)} off.`
              : "Applied when you submit your payment below."}
          </small>
        </div>
        {appliedPromo ? (
          <div>
            <dt>Promo code discount</dt>
            <dd className={styles.savings}>-{money(appliedPromo.discountAmount)}</dd>
          </div>
        ) : null}
```

Update `const dueNow = ...` and the final amount displayed to subtract `appliedPromo?.discountAmount ?? 0` from `pricing.finalAmount` everywhere it's used for the on-screen total (the actual authoritative charge is still whatever `booking_totals.total_amount` says server-side once `redeem_promotion` has run — this is a client preview only, consistent with how `pricing.finalAmount` is already just a client preview of what `create_multi_day_time_based_booking` computes).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Manual verification**

Start the dev server, run through the full single-item reserve flow with a valid active promo code from Task 6, confirm the discount line appears after "Submit Payment & Continue" and the booking's total in `/account/bookings` (or wherever the customer views their booking) reflects the reduced amount.

- [ ] **Step 5: Commit**

```bash
git add components/reservation/StepPaymentSubmission.tsx app/catalog/[id]/reserve/ReserveFlowClient.tsx
git commit -m "feat: add promo code redemption to the single-item reserve flow"
```

---

## Task 9: Checkout promo code — cart checkout flow

**Files:**
- Modify: `components/reservation/StepCartPaymentSubmission.tsx`, `app/checkout/CheckoutFlowClient.tsx` (around line 371, mirroring Task 8's insertion point)

**Interfaces:**
- Consumes: same as Task 8.
- Mirrors Task 8 exactly for the cart flow. Read both `StepCartPaymentSubmission.tsx` and `CheckoutFlowClient.tsx` in full first — they were confirmed structurally parallel to their single-item counterparts during planning (both call `calculateReservationPricing`/`calculateMultiItemReservationPricing` and both show the same birthday/loyalty summary lines) but were not fully read, so confirm the exact prop names and the exact line where `activeBookingId`/`bookingId` gets set after `createMultiItemBookingReservation` succeeds before editing.

- [ ] **Step 1: Add promo code state and redeem call to `CheckoutFlowClient.tsx`**

Same pattern as Task 8 Step 1, applied at this file's analogous booking-creation success point (near line 371).

- [ ] **Step 2: Add promo code UI to `StepCartPaymentSubmission.tsx`**

Same pattern as Task 8 Step 2.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Manual verification**

Add 2+ items to the cart, run the full cart checkout with an active promo code, confirm the discount applies once to the whole multi-item booking (not per line item).

- [ ] **Step 5: Commit**

```bash
git add components/reservation/StepCartPaymentSubmission.tsx app/checkout/CheckoutFlowClient.tsx
git commit -m "feat: add promo code redemption to the cart checkout flow"
```

---

## Task 10: Newsletter signup, subscribe API, and unsubscribe page

**Files:**
- Create: `app/api/newsletter/subscribe/route.ts`, `components/newsletter/NewsletterSignup.tsx`, `components/newsletter/NewsletterSignup.module.css`, `app/unsubscribe/page.tsx`, `app/unsubscribe/UnsubscribeClient.tsx`
- Modify: `components/footer/SiteFooter.tsx` (add the signup form to the existing brand column)

**Interfaces:**
- Consumes: `public.subscribe_newsletter`/`unsubscribe_newsletter` RPCs (Task 3), `sendEmail()` from `src/lib/server/emailTransport.ts`.
- Produces: `POST /api/newsletter/subscribe` → `{ success: true; alreadySubscribed: boolean }` or `{ error }`.

- [ ] **Step 1: Write `app/api/newsletter/subscribe/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/src/lib/supabase/server";
import { enforceRateLimit } from "@/src/lib/server/requestSecurity";
import { sendEmail } from "@/src/lib/server/emailTransport";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "newsletter-subscribe", 10, 60_000);
    const body = (await request.json()) as { email?: unknown; consent?: unknown; source?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const consent = body.consent === true;
    const source = typeof body.source === "string" ? body.source.slice(0, 40) : undefined;

    if (!consent) {
      return NextResponse.json({ error: "Please check the consent box to subscribe." }, { status: 400 });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("subscribe_newsletter", { p_email: email, p_source: source ?? null })
      .single();
    if (error || !data) throw new Error(error?.message ?? "Subscription failed.");

    if (!data.already_subscribed) {
      const unsubscribeUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://maddyandcassyrentals-nine.vercel.app"}/unsubscribe?token=${data.unsubscribe_token}`;
      void sendEmail({
        to: email,
        subject: "You're subscribed — Rental by Maddy & Cassy",
        html: `<p>Thanks for subscribing to Maddy &amp; Cassy updates. We'll only email about new gear, promotions, and availability.</p><p><a href="${unsubscribeUrl}">Unsubscribe anytime</a>.</p>`,
        text: `Thanks for subscribing to Maddy & Cassy updates. Unsubscribe anytime: ${unsubscribeUrl}`,
        idempotencyKey: `newsletter-welcome-${data.unsubscribe_token}`,
        logContext: { flow: "newsletter_welcome" },
      });
    }

    return NextResponse.json({ success: true, alreadySubscribed: Boolean(data.already_subscribed) });
  } catch (error) {
    console.error("Newsletter subscribe failed", error);
    return NextResponse.json({ error: "We couldn't complete your subscription. Please try again." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write `components/newsletter/NewsletterSignup.tsx`**

```typescript
"use client";

import { useState } from "react";
import styles from "./NewsletterSignup.module.css";

export default function NewsletterSignup({ source }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!consent) {
      setStatus("error");
      setMessage("Please agree to receive emails before subscribing.");
      return;
    }
    setStatus("submitting");
    setMessage(null);
    try {
      const response = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, consent, source }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Subscription failed.");
      setStatus("success");
      setMessage(body.alreadySubscribed ? "You're already on the list!" : "Subscribed! Check your inbox for confirmation.");
      setEmail("");
      setConsent(false);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Subscription failed. Please try again.");
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label htmlFor="newsletter-email" className={styles.label}>Get updates on new gear &amp; promotions</label>
      <div className={styles.row}>
        <input
          id="newsletter-email"
          type="email"
          required
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === "submitting"}
        />
        <button type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? "Subscribing…" : "Subscribe"}
        </button>
      </div>
      <label className={styles.consent}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={status === "submitting"} />
        I agree to receive occasional emails from Maddy &amp; Cassy. Unsubscribe anytime.
      </label>
      {message ? (
        <p role={status === "error" ? "alert" : "status"} className={status === "error" ? styles.errorText : styles.successText}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 3: Wire into `SiteFooter.tsx`**

Add `<NewsletterSignup source="footer" />` inside the `brandColumn` div (after the existing `serviceNote` block, around line 98), styled to sit naturally beneath the brand description — read `SiteFooter.module.css` first for the existing spacing/type scale.

- [ ] **Step 4: Write the unsubscribe page**

`app/unsubscribe/page.tsx` (server component reading the `token` search param, delegating to a client component):

```typescript
import type { Metadata } from "next";
import UnsubscribeClient from "./UnsubscribeClient";

export const metadata: Metadata = {
  title: "Unsubscribe | Rental by Maddy & Cassy",
  description: "Unsubscribe from Maddy & Cassy email updates.",
};

interface UnsubscribePageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
  const { token } = await searchParams;
  return <UnsubscribeClient token={token ?? null} />;
}
```

`app/unsubscribe/UnsubscribeClient.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/src/lib/supabase/client";

export default function UnsubscribeClient({ token }: { token: string | null }) {
  const [status, setStatus] = useState<"pending" | "done" | "error">("pending");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    createClient()
      .rpc("unsubscribe_newsletter", { p_token: token })
      .then(({ data, error }) => {
        if (cancelled) return;
        setStatus(!error && data ? "done" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main style={{ maxWidth: 480, margin: "80px auto", textAlign: "center", padding: "0 16px" }}>
      {status === "pending" ? <p>Processing your request…</p> : null}
      {status === "done" ? <p>You've been unsubscribed. You won't receive further marketing emails from us.</p> : null}
      {status === "error" ? <p>That unsubscribe link is invalid or has already been used.</p> : null}
    </main>
  );
}
```

Check whether `src/lib/supabase/client.ts` exists with a `createClient()` export (used elsewhere in client components, e.g. imported in `ReserveFlowClient.tsx` per the earlier `import { createClient } from ...` pattern) before writing this — reuse that exact import path.

- [ ] **Step 5: Write `scripts/testMarketingCopy.ts`**

```typescript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));

test("newsletter signup requires explicit consent before submitting", () => {
  const source = readFileSync(join(here, "../components/newsletter/NewsletterSignup.tsx"), "utf8");
  assert.match(source, /if \(!consent\)/);
  assert.match(source, /type="checkbox"/);
});

test("newsletter subscribe API rejects requests without consent", () => {
  const source = readFileSync(join(here, "../app/api/newsletter/subscribe/route.ts"), "utf8");
  assert.match(source, /if \(!consent\)/);
  assert.match(source, /Please check the consent box to subscribe\./);
});

test("newsletter subscribe API validates email format server-side, not just client-side", () => {
  const source = readFileSync(join(here, "../app/api/newsletter/subscribe/route.ts"), "utf8");
  assert.match(source, /\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$/);
});
```

- [ ] **Step 6: Run test, typecheck, manual verification**

Run: `npx tsx --test scripts/testMarketingCopy.ts` — expect PASS (3 tests). Run `npx tsc --noEmit`. Start the dev server, subscribe with a real test email, confirm the success message, confirm resubmitting the same email shows "already on the list," and confirm the unsubscribe link works.

- [ ] **Step 7: Commit**

```bash
git add app/api/newsletter components/newsletter app/unsubscribe components/footer/SiteFooter.tsx scripts/testMarketingCopy.ts
git commit -m "feat: add newsletter signup with consent, dedup, and unsubscribe flow"
```

---

## Task 11: Admin Marketing UI — Subscribers tab

**Files:**
- Create: `app/api/admin/newsletter/route.ts`
- Modify: `components/admin/AdminMarketingManager.tsx` (replace the Subscribers tab placeholder)

**Interfaces:**
- Consumes: `public.newsletter_subscribers` (Task 3), `requireActiveAdmin()`.
- Produces: `GET /api/admin/newsletter` → `{ subscribers: { email, status, consentedAt, source }[]; totalSubscribed: number }`.

- [ ] **Step 1: Write `app/api/admin/newsletter/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-newsletter-read", 30, 60_000);
    const { supabase } = await requireActiveAdmin();

    const { data, error } = await supabase
      .from("newsletter_subscribers")
      .select("email, status, consented_at, source")
      .order("consented_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const subscribers = (data ?? []).map((row) => ({
      email: row.email,
      status: row.status,
      consentedAt: row.consented_at,
      source: row.source,
    }));
    const totalSubscribed = subscribers.filter((s) => s.status === "subscribed").length;

    return NextResponse.json({ subscribers, totalSubscribed });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin newsletter read failed", error);
    return NextResponse.json({ error: "Subscribers could not be loaded." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Replace the Subscribers tab placeholder in `AdminMarketingManager.tsx`**

Add `subscribers`/`subscriberTotal` state, a `useEffect` (gated on `activeTab === "subscribers"`) that fetches `/api/admin/newsletter` once, and replace `activeTab === "subscribers" ? <p className={styles.empty}>Coming soon.</p>` with a summary line (`{subscriberTotal} active subscribers`) plus a `<table>` of email/status/source/consentedAt, matching the promotions table's styling.

- [ ] **Step 3: Typecheck and manual verification**

Run: `npx tsc --noEmit`. Visit `/admin/marketing`, switch to the Subscribers tab, confirm the test subscription from Task 10 appears.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/newsletter components/admin/AdminMarketingManager.tsx
git commit -m "feat: add admin newsletter subscribers view"
```

---

## Task 12: Client analytics tracking library and event wiring

**Files:**
- Create: `app/api/analytics/track/route.ts`, `src/lib/analytics/track.ts`
- Modify: `app/catalog/[id]/ProductDetailsClient.tsx` (product_view), catalog search UI (search — locate first via grep for the search input in `app/catalog/`), `components/reserve-action/ReserveAction.tsx` + `components/catalog-product-card/CatalogProductCard.tsx` (add_to_cart), `app/catalog/[id]/reserve/ReserveFlowClient.tsx` + `app/checkout/CheckoutFlowClient.tsx` (checkout_start on mount, booking_completed on success — the same files touched in Tasks 8/9, so land this after those merge to avoid conflicts)

**Interfaces:**
- Produces: `getSessionId(): string`, `track(eventType: MarketingEventType, payload?: { productId?: string; promotionId?: string; bookingId?: string; metadata?: Record<string, unknown> }): void` in `src/lib/analytics/track.ts` — fire-and-forget, never throws, never blocks the calling code.

- [ ] **Step 1: Write `app/api/analytics/track/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/src/lib/supabase/server";
import { enforceRateLimit } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";

const ALLOWED_EVENT_TYPES = new Set([
  "product_view", "search", "add_to_cart", "checkout_start",
  "booking_completed", "promotion_applied", "newsletter_signup",
]);

export async function POST(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "analytics-track", 120, 60_000);
    const body = (await request.json()) as Record<string, unknown>;
    const eventType = typeof body.eventType === "string" ? body.eventType : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!ALLOWED_EVENT_TYPES.has(eventType) || !sessionId) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const supabase = await createClient();
    const { error } = await supabase.rpc("log_marketing_event", {
      p_event_type: eventType,
      p_session_id: sessionId,
      p_product_id: typeof body.productId === "string" ? body.productId : null,
      p_promotion_id: typeof body.promotionId === "string" ? body.promotionId : null,
      p_booking_id: typeof body.bookingId === "string" ? body.bookingId : null,
      p_metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      p_utm_source: typeof body.utmSource === "string" ? body.utmSource : null,
      p_utm_medium: typeof body.utmMedium === "string" ? body.utmMedium : null,
      p_utm_campaign: typeof body.utmCampaign === "string" ? body.utmCampaign : null,
      p_utm_term: typeof body.utmTerm === "string" ? body.utmTerm : null,
      p_utm_content: typeof body.utmContent === "string" ? body.utmContent : null,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (error) {
    // Analytics must never surface an error to the user or break the flow
    // that triggered it -- log server-side only.
    console.error("Analytics track failed", error);
    return NextResponse.json({ success: false }, { status: 200 });
  }
}
```

- [ ] **Step 2: Write `src/lib/analytics/track.ts`**

```typescript
"use client";

const SESSION_KEY = "maddy-cassy-analytics-session";
const UTM_KEY = "maddy-cassy-analytics-utm";

export type MarketingEventType =
  | "product_view" | "search" | "add_to_cart" | "checkout_start"
  | "booking_completed" | "promotion_applied" | "newsletter_signup";

interface TrackPayload {
  productId?: string;
  promotionId?: string;
  bookingId?: string;
  metadata?: Record<string, unknown>;
}

export function getSessionId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return "unavailable";
  }
}

interface UtmParams {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

/** Captures UTM params from the first landing URL in a session and remembers them for later events. */
export function captureUtmParams(): UtmParams {
  if (typeof window === "undefined") return {};
  try {
    const stored = window.sessionStorage.getItem(UTM_KEY);
    if (stored) return JSON.parse(stored) as UtmParams;

    const params = new URLSearchParams(window.location.search);
    const captured: UtmParams = {
      utmSource: params.get("utm_source") ?? undefined,
      utmMedium: params.get("utm_medium") ?? undefined,
      utmCampaign: params.get("utm_campaign") ?? undefined,
      utmTerm: params.get("utm_term") ?? undefined,
      utmContent: params.get("utm_content") ?? undefined,
    };
    if (Object.values(captured).some(Boolean)) {
      window.sessionStorage.setItem(UTM_KEY, JSON.stringify(captured));
    }
    return captured;
  } catch {
    return {};
  }
}

/** Fire-and-forget event log. Never throws, never blocks the caller. */
export function track(eventType: MarketingEventType, payload: TrackPayload = {}): void {
  if (typeof window === "undefined") return;
  const utm = captureUtmParams();
  void fetch("/api/analytics/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventType,
      sessionId: getSessionId(),
      productId: payload.productId,
      promotionId: payload.promotionId,
      bookingId: payload.bookingId,
      metadata: payload.metadata ?? {},
      ...utm,
    }),
    keepalive: true,
  }).catch(() => undefined);
}
```

- [ ] **Step 3: Wire `product_view`**

In `app/catalog/[id]/ProductDetailsClient.tsx`, add a `useEffect(() => { track("product_view", { productId: product.id }); }, [product.id]);` (read the file first to find its existing `useEffect` imports/conventions and the exact `product` prop shape).

- [ ] **Step 4: Wire `search`**

Run `grep -rn "search" app/catalog --include=*.tsx` to locate the actual search/filter input (not located during planning). Add a debounced `track("search", { metadata: { query } })` call on query change (debounce ~500ms using the same pattern as any existing debounce in that file, or a simple `setTimeout`/`clearTimeout` pair if none exists) — only fire when the query is non-empty, to avoid logging every keystroke or every empty-state render.

- [ ] **Step 5: Wire `add_to_cart`**

In `components/reserve-action/ReserveAction.tsx`, inside the "Add to Cart" button's `onClick` (line 53-59), add `track("add_to_cart", { productId: product.id, metadata: { quantity: 1, color } });` alongside the existing `addItem(...)` call. Do the same at `CatalogProductCard.tsx`'s add-to-cart button (locate it — the planning research noted this card has `ctaLabel = "Reserve Now"` and a `View Details` link; confirm whether it also has its own add-to-cart action or only `ReserveAction` does, and only add tracking where an actual add-to-cart action exists).

- [ ] **Step 6: Wire `checkout_start` and `booking_completed`**

In `ReserveFlowClient.tsx` and `CheckoutFlowClient.tsx`: add a `useEffect(() => { track("checkout_start", { productId: product.id }); }, []);` (or the cart equivalent, tracking each line's product in `metadata`) near the top of the component, firing once on mount. In `handleManualPaymentContinue` (both files), after the booking is successfully created (same spot as the Task 8/9 promo redemption call), add `track("booking_completed", { bookingId: activeBookingId, metadata: { isGuest } });`.

- [ ] **Step 7: Wire `newsletter_signup`**

In `components/newsletter/NewsletterSignup.tsx` (Task 10), on successful subscribe (`status === "success"` branch), add `track("newsletter_signup", {});`.

- [ ] **Step 8: Typecheck and manual verification**

Run: `npx tsc --noEmit`. Click through: view a product, search, add to cart, start checkout, complete a booking, subscribe to the newsletter — then, as an admin, query `select event_type, count(*) from analytics_events group by event_type;` via the Supabase SQL editor (or `mcp__claude_ai_Supabase__execute_sql` once authorized) to confirm every event type logged at least once.

- [ ] **Step 9: Commit**

```bash
git add app/api/analytics src/lib/analytics app/catalog components/reserve-action components/catalog-product-card app/catalog/[id]/reserve/ReserveFlowClient.tsx app/checkout/CheckoutFlowClient.tsx components/newsletter/NewsletterSignup.tsx
git commit -m "feat: add first-party conversion event tracking across the storefront"
```

---

## Task 13: Admin marketing metrics

**Files:**
- Create: `supabase/migrations/20260929094000_marketing_metrics.sql`, `app/api/admin/marketing/metrics/route.ts`
- Modify: `components/admin/AdminMarketingManager.tsx` (replace the Metrics tab placeholder)

**Interfaces:**
- Produces: `public.get_marketing_metrics(p_since timestamptz default now() - interval '30 days')` RPC returning `jsonb` with real, computed-not-fabricated fields: `eventCounts` (by type), `promotionUsage` (per active/expired promo: redemptions, discount given), `bookingConversion` (`checkoutStarts`, `bookingsCompleted`, `conversionRate`), `repeatCustomers` (count of customers with >1 completed booking), `acquisitionSources` (utm_source counts on `booking_completed` events, `"direct"` bucket for null).

- [ ] **Step 1: Write the migration**

```sql
begin;

create or replace function public.get_marketing_metrics(p_since timestamptz default now() - interval '30 days')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'ADMIN_ONLY';
  end if;

  select jsonb_build_object(
    'eventCounts', (
      select coalesce(jsonb_object_agg(event_type, event_count), '{}'::jsonb)
      from (
        select event_type, count(*) as event_count
        from public.analytics_events
        where created_at >= p_since
        group by event_type
      ) counts
    ),
    'promotionUsage', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', p.code,
        'title', p.title,
        'isActive', p.is_active,
        'redemptions', coalesce(r.redemption_count, 0),
        'totalDiscountGiven', coalesce(r.total_discount, 0)
      )), '[]'::jsonb)
      from public.promotions p
      left join (
        select promotion_id, count(*) as redemption_count, sum(discount_amount) as total_discount
        from public.promotion_redemptions
        group by promotion_id
      ) r on r.promotion_id = p.id
    ),
    'bookingConversion', (
      select jsonb_build_object(
        'checkoutStarts', (select count(*) from public.analytics_events where event_type = 'checkout_start' and created_at >= p_since),
        'bookingsCompleted', (select count(*) from public.analytics_events where event_type = 'booking_completed' and created_at >= p_since),
        'conversionRate', (
          case when (select count(*) from public.analytics_events where event_type = 'checkout_start' and created_at >= p_since) > 0
          then round(
            (select count(*) from public.analytics_events where event_type = 'booking_completed' and created_at >= p_since)::numeric
            / (select count(*) from public.analytics_events where event_type = 'checkout_start' and created_at >= p_since)::numeric * 100,
            1
          )
          else 0 end
        )
      )
    ),
    'repeatCustomers', (
      select count(*) from (
        select customer_id from public.bookings
        where status = 'returned' and is_guest_checkout = false
        group by customer_id having count(*) > 1
      ) repeats
    ),
    'acquisitionSources', (
      select coalesce(jsonb_object_agg(source_label, source_count), '{}'::jsonb)
      from (
        select coalesce(utm_source, 'direct') as source_label, count(*) as source_count
        from public.analytics_events
        where event_type = 'booking_completed' and created_at >= p_since
        group by coalesce(utm_source, 'direct')
      ) sources
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_marketing_metrics(timestamptz) from public, anon;
grant execute on function public.get_marketing_metrics(timestamptz) to authenticated;

commit;
```

- [ ] **Step 2: Write `app/api/admin/marketing/metrics/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-marketing-metrics", 20, 60_000);
    const { supabase } = await requireActiveAdmin();

    const { data, error } = await supabase.rpc("get_marketing_metrics");
    if (error) throw new Error(error.message);

    return NextResponse.json({ metrics: data });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin marketing metrics read failed", error);
    return NextResponse.json({ error: "Metrics could not be loaded." }, { status: 500 });
  }
}
```

- [ ] **Step 3: Replace the Metrics tab placeholder in `AdminMarketingManager.tsx`**

Add `metrics` state, a `useEffect` (gated on `activeTab === "metrics"`) fetching `/api/admin/marketing/metrics` once, and render: an event-count summary row, a booking-conversion stat (`checkoutStarts → bookingsCompleted, conversionRate%`), a repeat-customers count, a small acquisition-source table, and reuse the promotions table styling for per-promotion usage (this duplicates some of what the Promotions tab already shows per-row — that's fine, this tab is the "at a glance" summary view). Every number renders directly from the RPC response; never compute or display a placeholder/example value.

- [ ] **Step 4: Show the user the migration SQL, confirm, apply, regenerate types**

Same procedure as prior migration tasks.

- [ ] **Step 5: Typecheck and manual verification**

Run: `npx tsc --noEmit`. Visit `/admin/marketing`, switch to Metrics, confirm the numbers match what you'd expect from the test events/bookings/promotions created during Tasks 6-12's manual verification steps.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260929094000_marketing_metrics.sql app/api/admin/marketing components/admin/AdminMarketingManager.tsx src/lib/supabase/database.types.ts
git commit -m "feat: add admin marketing metrics summary"
```

---

## Task 14: SEO metadata, Open Graph, sitemap, robots.txt

**Files:**
- Modify: `app/layout.tsx:24-32`, `app/page.tsx`, `app/catalog/page.tsx:7-8`, `app/catalog/[id]/page.tsx:13-27`
- Create: `app/sitemap.ts`, `app/robots.ts`

**Interfaces:**
- Consumes: `getActiveProducts()` from `src/services/productService.ts` (already used in `app/catalog/[id]/page.tsx:37`).

- [ ] **Step 1: Extend root layout metadata**

In `app/layout.tsx`, replace the `metadata` object (lines 24-32) with:

```typescript
const siteUrl = "https://maddyandcassyrentals-nine.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Rental by Maddy & Cassy",
    template: "%s | Rental by Maddy & Cassy",
  },
  description:
    "Premium camera and iPhone rentals in Metro Manila. Quality equipment, simple booking, transparent pricing.",
  icons: {
    icon: "/images/maddy-cassy-rentals-icon.png",
    apple: "/images/maddy-cassy-rentals-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "Rental by Maddy & Cassy",
    title: "Rental by Maddy & Cassy",
    description: "Premium camera and iPhone rentals in Metro Manila. Quality equipment, simple booking, transparent pricing.",
    url: siteUrl,
    images: [{ url: "/images/maddy-cassy-rentals-logo.png", width: 512, height: 512, alt: "Rental by Maddy & Cassy" }],
  },
  twitter: {
    card: "summary",
    title: "Rental by Maddy & Cassy",
    description: "Premium camera and iPhone rentals in Metro Manila. Quality equipment, simple booking, transparent pricing.",
    images: ["/images/maddy-cassy-rentals-logo.png"],
  },
};
```

(Using the `title.template` form means every page-specific `metadata.title` string — e.g. `"Catalog & Pricing | Rental by Maddy & Cassy Admin"` in `app/admin/catalog/page.tsx` — will now get the site name appended twice. Check each existing static `metadata` export across `app/**/page.tsx` for ones that already manually append `"| Rental by Maddy & Cassy"` and strip that suffix so the template doesn't double it — `app/catalog/page.tsx`, `app/checkout/page.tsx`, and all `app/admin/**/page.tsx` files need this check.)

- [ ] **Step 2: Add homepage-specific metadata**

In `app/page.tsx` (currently has no `export const metadata` at all), add:

```typescript
export const metadata: Metadata = {
  title: "Premium Camera & iPhone Rentals in Metro Manila",
  description: "Rent DSLRs, mirrorless cameras, and iPhones in Metro Manila. Transparent pricing, birthday-month and loyalty discounts, and a simple online booking process.",
  openGraph: {
    title: "Premium Camera & iPhone Rentals in Metro Manila",
    description: "Rent DSLRs, mirrorless cameras, and iPhones in Metro Manila. Transparent pricing, birthday-month and loyalty discounts, and a simple online booking process.",
  },
};
```

(Import `Metadata` from `"next"` if not already imported in this file — check first, since `app/page.tsx` may currently have no metadata-related imports at all.)

- [ ] **Step 3: Extend catalog and product-detail metadata with Open Graph**

In `app/catalog/page.tsx`, add `openGraph: { title: ..., description: ... }` mirroring the existing static title/description. In `app/catalog/[id]/page.tsx`'s `generateMetadata` (lines 13-27), add an `images` array to `openGraph` using the product's first image (`product.images[0]?.url`, matching the fallback pattern already used in `bookingSubmissionService.ts:79`), e.g.:

```typescript
  return {
    title: `${product.name} | Rental by Maddy & Cassy`,
    description: product.description,
    openGraph: {
      title: product.name,
      description: product.description,
      images: product.images[0]?.url ? [{ url: product.images[0].url }] : undefined,
    },
  };
```

- [ ] **Step 4: Write `app/sitemap.ts`**

```typescript
import type { MetadataRoute } from "next";
import { getActiveProducts } from "@/src/services/productService";

const siteUrl = "https://maddyandcassyrentals-nine.vercel.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getActiveProducts();

  const staticRoutes = [
    "", "/catalog", "/how-to-book", "/rental-requirements", "/faq", "/contact", "/terms", "/privacy",
  ].map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified: new Date(),
  }));

  const productRoutes = products.map((product) => ({
    url: `${siteUrl}/catalog/${product.id}`,
    lastModified: new Date(),
  }));

  return [...staticRoutes, ...productRoutes];
}
```

- [ ] **Step 5: Write `app/robots.ts`**

```typescript
import type { MetadataRoute } from "next";

const siteUrl = "https://maddyandcassyrentals-nine.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/account", "/checkout", "/cart", "/api", "/messages"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
```

- [ ] **Step 6: Typecheck and build**

Run: `npx tsc --noEmit` then `npm run build` (the sitemap/robots files are validated at build time). Visit `/sitemap.xml` and `/robots.txt` locally to confirm they render.

- [ ] **Step 7: Commit**

```bash
git add app/layout.tsx app/page.tsx app/catalog/page.tsx "app/catalog/[id]/page.tsx" app/sitemap.ts app/robots.ts
git commit -m "feat: add SEO metadata, Open Graph tags, sitemap, and robots.txt"
```

---

## Task 15: CTA hierarchy pass

**Files:**
- Modify: `components/reserve-action/ReserveAction.module.css`, `components/catalog-product-card/CatalogProductCard.module.css` (read both before editing — not read during planning)

**Interfaces:**
- No new interfaces — purely a visual-weight pass on existing buttons/links, using existing design tokens only.

- [ ] **Step 1: Read the current styling**

Read `components/reserve-action/ReserveAction.module.css` in full and identify the current rules for `.reserveButton` and `.cartButton`. Read `components/catalog-product-card/CatalogProductCard.module.css` and identify the rules for whatever class renders the "Reserve Now" CTA vs. the "View Details" link. Read `app/globals.css` (or wherever the brand's primary accent color custom property is defined, e.g. `--color-primary`/`--brand-pink`) to find the existing token names.

- [ ] **Step 2: Establish one clear primary CTA per component**

In `ReserveAction.module.css`: ensure `.reserveButton` uses the brand's solid/filled primary style (existing accent background, white text) and `.cartButton` uses a visually lighter secondary style (outline or muted fill) — if they already differ this way, leave as-is and only note it in the commit message; if they currently look equally weighted (same fill color/size), demote `.cartButton` to an outline/secondary treatment using only existing tokens, no new colors.

In `CatalogProductCard.module.css`: confirm "Reserve Now" (or the card's default CTA) is the visually dominant element on the card and "View Details" reads as a lower-emphasis secondary link (e.g. underlined text or ghost-button style) rather than a second competing solid button. Adjust only if they currently compete.

- [ ] **Step 3: Manual visual verification**

Start the dev server, view `/catalog` and a product detail page at both desktop and mobile widths (per the project's existing responsive breakpoints), confirm exactly one visually dominant action per card/section and that touch targets remain accessible (no size regressions below the existing minimum).

- [ ] **Step 4: Commit**

```bash
git add components/reserve-action/ReserveAction.module.css components/catalog-product-card/CatalogProductCard.module.css
git commit -m "style: clarify primary/secondary CTA hierarchy on reserve and catalog card actions"
```

---

## Task 16: Wire `verify` script and final branch review prep

**Files:**
- Modify: `package.json` (`scripts` section)

- [ ] **Step 1: Add the new test scripts and extend `verify`**

In `package.json`, add:

```json
    "test:promotions": "tsx --test scripts/testPromotions.ts",
    "test:newsletter": "tsx --test scripts/testNewsletter.ts",
    "test:analytics-track": "tsx --test scripts/testAnalyticsTrack.ts",
    "test:marketing-copy": "tsx --test scripts/testMarketingCopy.ts",
```

and extend the existing `"verify"` script string to include `&& npm run test:promotions && npm run test:newsletter && npm run test:analytics-track && npm run test:marketing-copy` before the trailing `&& npm run build`.

- [ ] **Step 2: Run the full verify suite**

Run: `npm run verify`
Expected: PASS end-to-end (lint, typecheck, all `test:*` scripts including the four new ones, build).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: wire new marketing tests into npm run verify"
```
