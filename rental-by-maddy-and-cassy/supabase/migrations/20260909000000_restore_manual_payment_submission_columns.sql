-- Restore three columns that migration
-- 20260804000000_normalize_booking_schema_rpc_fixes.sql (section 2) was meant to
-- add to public.booking_payment_submissions but that are absent from the live
-- database (project nyyjzgpaysuaaqjyibmi). The paired additive columns from the
-- same statement -- provider_metadata, currency_code, completed_at -- are already
-- present, so only these three are missing:
--
--   * paymongo_payment_id           -- also doubles as the general "external
--                                      payment id" slot written by
--                                      src/lib/server/paymentFulfillment.ts on
--                                      every verified payment
--   * paymongo_checkout_session_id  -- referenced by src/lib/supabase/database.types.ts
--   * idempotency_key               -- referenced by src/lib/supabase/database.types.ts
--
-- Effect of the drift, before this migration:
--   * GET /api/admin/payments -> getPaymentRecordsPage()/getPaymentMetricsSummary()
--     filter `.is("paymongo_payment_id", null)`, so PostgREST returned
--     `42703 column booking_payment_submissions.paymongo_payment_id does not exist`
--     and the Admin -> Payments page showed "Payment activity could not be loaded."
--   * Verifying a submitted GCash proof (fulfillVerifiedPayment) updates
--     paymongo_payment_id, so payment approval failed with the same 42703.
--
-- Additive and idempotent: safe to run even where the columns already exist.

begin;

alter table public.booking_payment_submissions
  add column if not exists paymongo_checkout_session_id text,
  add column if not exists paymongo_payment_id text,
  add column if not exists idempotency_key text;

create unique index if not exists booking_payment_submissions_idempotency_key_idx
  on public.booking_payment_submissions(idempotency_key)
  where idempotency_key is not null;

create unique index if not exists booking_payment_submissions_checkout_session_idx
  on public.booking_payment_submissions(paymongo_checkout_session_id)
  where paymongo_checkout_session_id is not null;

create index if not exists booking_payment_submissions_paymongo_payment_idx
  on public.booking_payment_submissions(paymongo_payment_id)
  where paymongo_payment_id is not null;

comment on column public.booking_payment_submissions.paymongo_payment_id is
  'External payment id. PayMongo is retired; the manual-review fulfillment path now stores the verified GCash reference here.';
comment on column public.booking_payment_submissions.paymongo_checkout_session_id is
  'Legacy PayMongo checkout session id. Retained for schema/type parity; no longer written.';

commit;
