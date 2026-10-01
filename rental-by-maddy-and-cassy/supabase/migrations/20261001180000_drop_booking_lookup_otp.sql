-- Track Booking no longer uses emailed one-time codes: a booking reference
-- now shows only the public tracking timeline, and documents, payments, and
-- account actions stay behind the normal sign-in. Remove the unused OTP
-- challenge functions and table added by 20261001140000_booking_lookup_otp.
-- Customer account login/OTP is handled by Supabase Auth and is unaffected.

begin;

drop function if exists public.redeem_booking_lookup_challenge(uuid, text, uuid);
drop function if exists public.create_booking_lookup_challenge(uuid, text);
drop table if exists public.booking_lookup_challenges;

commit;
