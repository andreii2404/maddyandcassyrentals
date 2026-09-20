-- Products committed to long-term rentals must not be advertised or assigned
-- to a new booking. Keep every record for history/admin use, but remove its
-- active catalog status and rentable inventory capacity.

update public.products
set status = 'inactive',
    updated_at = now()
where name in ('Insta360 X5', 'Samsung NX Mini')
  and status <> 'inactive';

update public.inventory_units iu
set lifecycle_status = 'maintenance',
    updated_at = now()
where iu.lifecycle_status = 'active'
  and exists (
    select 1
    from public.products p
    where p.id = iu.product_id
      and p.name in ('Insta360 X5', 'Samsung NX Mini')
  );

-- These two requested listings are color variants within otherwise-rentable
-- products. Their physical units stay recorded but cannot be selected by any
-- availability or booking RPC, all of which only allocate active units.
update public.inventory_units iu
set lifecycle_status = 'maintenance',
    updated_at = now()
where iu.lifecycle_status = 'active'
  and (
    (iu.unit_code = 'IP17PM-03' and exists (
      select 1 from public.products p
      where p.id = iu.product_id and p.name = 'iPhone 17 Pro Max'
    ))
    or
    (iu.unit_code = 'IP13P-02' and exists (
      select 1 from public.products p
      where p.id = iu.product_id and p.name = 'iPhone 13 Pro'
    ))
  );
