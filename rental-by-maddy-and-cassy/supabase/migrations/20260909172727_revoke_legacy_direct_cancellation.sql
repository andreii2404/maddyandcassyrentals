begin;

-- The customer UI now submits a request for admin review. Prevent the legacy
-- RPC from remaining an alternate path that immediately cancels a booking.
revoke all on function public.cancel_own_booking(uuid, text) from public, anon, authenticated;

commit;
