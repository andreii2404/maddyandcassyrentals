-- Pickup and delivery share the same customer-selected handover time. Enforce
-- the outside-hours fee at the persistence boundary so it cannot be omitted
-- or changed by a browser request. Existing bookings are intentionally left
-- untouched; the rule applies to new/updated fulfillment snapshots.

create or replace function private.apply_handover_convenience_fee()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_handover_time time;
begin
  select (b.pickup_at at time zone 'Asia/Manila')::time
    into v_handover_time
    from public.bookings b
    where b.id = new.booking_id;

  if v_handover_time is null then
    raise exception 'BOOKING_HANDOVER_TIME_REQUIRED';
  end if;

  new.pickup_convenience_fee_snapshot := case
    when v_handover_time < time '09:00' or v_handover_time > time '19:00' then 100
    else 0
  end;

  return new;
end;
$$;

revoke all on function private.apply_handover_convenience_fee()
  from public, anon, authenticated;

drop trigger if exists booking_fulfillments_apply_handover_fee
  on public.booking_fulfillments;

create trigger booking_fulfillments_apply_handover_fee
before insert or update
on public.booking_fulfillments
for each row
execute function private.apply_handover_convenience_fee();
