-- Older booking producers insert the pending notification without event_key.
-- Keep the column NOT NULL and repair the producer boundary in the database so
-- retries remain safe while newer callers can continue to provide explicit keys.
create or replace function private.set_email_notification_event_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_key is null or btrim(new.event_key) = '' then
    new.event_key := case
      when new.email_type = 'booking_pending' then
        'booking-pending-' || coalesce(new.booking_id::text, new.id::text, gen_random_uuid()::text)
      when new.email_type = 'booking_approved' then
        'booking-approved-' || coalesce(new.booking_id::text, new.id::text, gen_random_uuid()::text)
      when new.email_type = 'booking_returned' then
        'booking-returned-' || coalesce(new.booking_id::text, new.id::text, gen_random_uuid()::text)
      when new.email_type = 'payment_verified' then
        'payment-verified-' || coalesce(new.id::text, gen_random_uuid()::text)
      when new.email_type = 'payment_rejected' then
        'payment-rejected-' || coalesce(new.booking_id::text, new.id::text, gen_random_uuid()::text)
      when new.email_type = 'booking_confirmation_contract' then
        'booking-confirmation-contract-' || coalesce(new.booking_id::text, new.id::text, gen_random_uuid()::text)
      else
        replace(coalesce(nullif(btrim(new.email_type), ''), 'booking-event'), '_', '-')
          || '-' || coalesce(new.booking_id::text, new.id::text, gen_random_uuid()::text)
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists set_email_notification_event_key on public.email_notifications;
create trigger set_email_notification_event_key
before insert on public.email_notifications
for each row
execute function private.set_email_notification_event_key();
