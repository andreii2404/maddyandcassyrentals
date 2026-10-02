-- Same-day convenience fee.
--
-- A booking whose rental (pickup/delivery handover) date is the same Asia/Manila
-- calendar day the booking is made carries a flat PHP 100 convenience fee.
-- Advance bookings never do. The fee is stored separately from the
-- outside-hours pickup_convenience_fee_snapshot so both can be shown as their
-- own line items, and it is enforced at the persistence boundary so a browser
-- request cannot omit or change it.
--
-- The fee is decided once, when the fulfillment row is inserted (inside the
-- booking-creation transaction, so now() is the booking time). Later updates
-- to the fulfillment (courier details, admin edits) keep the original value,
-- so an existing booking's total never changes retroactively. Existing
-- bookings keep the column default of 0.
-- The client rule lives in src/lib/rentalTiming.ts (calculateSameDayFee) --
-- keep them in sync.

begin;

alter table public.booking_fulfillments
  add column if not exists same_day_fee_snapshot numeric(12,2) not null default 0;

alter table public.booking_fulfillments
  drop constraint if exists booking_fulfillments_same_day_fee_nonnegative;

alter table public.booking_fulfillments
  add constraint booking_fulfillments_same_day_fee_nonnegative
    check (same_day_fee_snapshot >= 0);

comment on column public.booking_fulfillments.same_day_fee_snapshot is
  'PHP 100 when the booking was made on the same Asia/Manila day as its pickup/delivery; 0 for advance bookings. Set on insert only.';

create or replace function private.apply_same_day_convenience_fee()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_handover_date date;
begin
  if tg_op = 'UPDATE' then
    new.same_day_fee_snapshot := old.same_day_fee_snapshot;
    return new;
  end if;

  select (b.pickup_at at time zone 'Asia/Manila')::date
    into v_handover_date
    from public.bookings b
    where b.id = new.booking_id;

  if v_handover_date is null then
    raise exception 'BOOKING_HANDOVER_TIME_REQUIRED';
  end if;

  new.same_day_fee_snapshot := case
    when v_handover_date = (now() at time zone 'Asia/Manila')::date then 100
    else 0
  end;

  return new;
end;
$$;

revoke all on function private.apply_same_day_convenience_fee()
  from public, anon, authenticated;

drop trigger if exists booking_fulfillments_apply_same_day_fee
  on public.booking_fulfillments;

create trigger booking_fulfillments_apply_same_day_fee
before insert or update
on public.booking_fulfillments
for each row
execute function private.apply_same_day_convenience_fee();

-- Same definition as 20260929091000_redeem_promotion.sql, plus the same-day
-- fee in total_amount and as a new trailing same_day_fee column.
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
    + coalesce(bf.same_day_fee_snapshot, 0::numeric)
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
  b.promotion_code_snapshot as promotion_code,
  coalesce(bf.same_day_fee_snapshot, 0::numeric)::numeric(12,2)
    as same_day_fee
from public.bookings b
left join public.booking_items bi on bi.booking_id = b.id
left join public.booking_fulfillments bf on bf.booking_id = b.id
group by b.id, bf.delivery_fee_snapshot, bf.pickup_convenience_fee_snapshot,
  bf.same_day_fee_snapshot, b.rental_period, b.birthday_discount_amount,
  b.loyalty_discount_amount, b.promotion_discount_amount, b.promotion_code_snapshot;

commit;
