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
