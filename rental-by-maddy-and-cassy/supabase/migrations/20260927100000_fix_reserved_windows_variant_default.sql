-- get_product_variant_reserved_windows (added in 20260927090000) declared
-- p_variant with no default, unlike its sibling
-- get_product_multi_day_time_availability in the same migration. The
-- client's rpc() call omits p_variant entirely (JSON.stringify drops the
-- undefined value) for products with no variant, so PostgREST can't match
-- a 3-argument call against a function requiring 4 named arguments,
-- failing every such request with "Could not find the function ... in the
-- schema cache". Add the missing default to match the established pattern.
create or replace function public.get_product_variant_reserved_windows(
  p_product_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_variant text default null
)
returns table (
  total_units bigint,
  windows jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with matching_units as (
    select iu.id
    from public.inventory_units iu
    where iu.product_id = p_product_id
      and iu.lifecycle_status = 'active'
      and (
        nullif(trim(p_variant), '') is null
        or lower(trim(iu.variant)) = lower(trim(p_variant))
      )
  )
  select
    (select count(*) from matching_units)::bigint as total_units,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'unitId', ur.inventory_unit_id,
          'start', lower(ur.reserved_window),
          'end', upper(ur.reserved_window)
        ))
        from public.unit_reservations ur
        where ur.inventory_unit_id in (select id from matching_units)
          and ur.status in ('tentative', 'confirmed', 'in_use')
          and ur.reserved_window && tstzrange(p_window_start, p_window_end, '[)')
      ),
      '[]'::jsonb
    ) as windows;
$$;

-- Postgres treats a changed parameter list as a new overload rather than a
-- replacement, so drop the old 4-arg (p_product_id, p_variant, p_window_start,
-- p_window_end) signature to avoid leaving both candidates in place, which
-- would reintroduce the "Could not choose the best candidate function"
-- ambiguity error this same file's history already warns about.
drop function if exists public.get_product_variant_reserved_windows(uuid, text, timestamptz, timestamptz);

revoke all on function public.get_product_variant_reserved_windows(uuid, timestamptz, timestamptz, text)
  from public;
grant execute on function public.get_product_variant_reserved_windows(uuid, timestamptz, timestamptz, text)
  to anon, authenticated;

comment on function public.get_product_variant_reserved_windows(uuid, timestamptz, timestamptz, text) is
  'Returns the active-unit total and every blocking reserved_window (inclusive of the 2-hour turnaround) for a product/variant within a date window, for client-side pickup-time slot disabling. Non-atomic UX hint only -- the create_*_booking RPCs re-check with row locks at submission time.';
