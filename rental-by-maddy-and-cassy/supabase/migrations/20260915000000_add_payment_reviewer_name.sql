-- Adds an explicit "who reviewed this" name, independent of which admin account
-- is logged in, so the payment proof review UI can require picking Maddy or
-- Cassy as the approver/rejecter rather than relying solely on reviewed_by
-- (the authenticated admin's Supabase user id).
alter table public.booking_payment_submissions
  add column if not exists reviewer_name text;

alter table public.booking_payment_submissions
  drop constraint if exists booking_payment_submissions_reviewer_name_check;

alter table public.booking_payment_submissions
  add constraint booking_payment_submissions_reviewer_name_check
  check (reviewer_name is null or reviewer_name in ('Maddy', 'Cassy'));
