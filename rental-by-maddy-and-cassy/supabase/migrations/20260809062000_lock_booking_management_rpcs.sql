begin;

revoke all on function public.update_own_booking_details(uuid, text, text, text, text, text) from anon;
revoke all on function public.cancel_own_booking(uuid, text) from anon;
revoke all on function public.admin_set_booking_status(uuid, text, text) from anon;

commit;
