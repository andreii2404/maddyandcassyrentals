-- Tracks whether/when an admin emailed the official receipt PDF to the
-- customer, so the admin UI can show "Receipt sent <date/time>" and the
-- send button can be idempotently re-enabled for a resend.
alter table public.booking_receipts
  add column if not exists emailed_at timestamptz,
  add column if not exists emailed_to text;
