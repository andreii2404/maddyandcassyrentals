-- Older catalog rows used a singular, capitalized Color key. Normalize those
-- rows so the storefront, availability RPCs, and booking allocator all agree
-- that the device has one selectable variant.
update public.products
set specifications = (specifications - 'Color') || jsonb_build_object('colors', trim(specifications ->> 'Color'))
where coalesce(nullif(trim(specifications ->> 'colors'), ''), '') = ''
  and nullif(trim(specifications ->> 'Color'), '') is not null;

update public.inventory_units iu
set variant = trim(p.specifications ->> 'colors'),
    updated_at = now()
from public.products p
where p.id = iu.product_id
  and iu.variant is null
  and iu.lifecycle_status = 'active'
  and nullif(trim(p.specifications ->> 'colors'), '') is not null
  and position(',' in p.specifications ->> 'colors') = 0;
