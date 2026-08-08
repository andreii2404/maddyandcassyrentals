-- Never trust product names, rates, deposits, discounts, or quantities sent by
-- a browser. Every booking_item is normalized from the administrator-managed
-- product row before it is written, including writes performed by
-- public.create_booking().

create or replace function private.enforce_booking_item_pricing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
  v_discount_percent numeric := 0;
  v_discount_text text;
begin
  if new.quantity is null or new.quantity < 1 or new.quantity > 10 then
    raise exception 'INVALID_QUANTITY';
  end if;

  select p.name, p.daily_rate, p.refundable_deposit, p.specifications, p.status
    into v_product
    from public.products p
    where p.id = new.product_id;

  if v_product.name is null or v_product.status <> 'active' then
    raise exception 'PRODUCT_NOT_AVAILABLE';
  end if;

  v_discount_text := nullif(v_product.specifications ->> 'discountPercent', '');
  if v_discount_text is not null and v_discount_text ~ '^([0-9]+)(\.[0-9]+)?$' then
    v_discount_percent := least(greatest(v_discount_text::numeric, 0), 90);
  end if;

  new.product_name_snapshot := v_product.name;
  new.daily_rate_snapshot := round(
    v_product.daily_rate * (1 - (v_discount_percent / 100)),
    2
  );
  new.deposit_per_unit_snapshot := v_product.refundable_deposit;
  return new;
end;
$$;

revoke all on function private.enforce_booking_item_pricing() from public, anon, authenticated;

drop trigger if exists enforce_booking_item_pricing on public.booking_items;
create trigger enforce_booking_item_pricing
before insert or update of product_id, product_name_snapshot, daily_rate_snapshot,
  deposit_per_unit_snapshot, quantity
on public.booking_items
for each row execute function private.enforce_booking_item_pricing();

comment on function private.enforce_booking_item_pricing() is
  'Normalizes every booking item to the current administrator-managed product price, discount, deposit, name, and quantity constraints.';
