-- Root-cause fix for incorrect product availability / date blocking.
--
-- What was wrong:
-- 1. The per-unit "does this window overlap an existing reservation" check
--    (unit unavailable iff EXISTS a tentative/confirmed/in_use unit_reservations
--    row whose reserved_window && the requested window) was copy-pasted
--    near-identically into every availability RPC
--    (get_product_time_availability, get_product_multi_day_time_availability,
--    plus the missing get_product_availability/get_product_availability_calendar
--    described below). Any future edit to one copy and not the others silently
--    reintroduces exactly this class of bug -- the calendar, the pickup-time
--    indicator, the quantity selector, and checkout would stop agreeing with
--    each other. This migration extracts that read-only check into one shared
--    helper, private.count_unit_availability(), and points every availability
--    RPC at it. The booking-creation RPCs (create_time_based_booking,
--    create_multi_day_time_based_booking, create_multi_item_booking) are left
--    untouched: they need row-level candidate unit ids under
--    `for update skip locked`, not just a count, so they keep their own
--    equivalent overlap predicate inline, backed by the same
--    unit_reservations_no_active_time_overlap exclusion constraint as the
--    final guard against races.
-- 2. public.get_product_availability() and public.get_product_availability_calendar()
--    are called by the frontend (productService.ts, inventoryService.ts,
--    availabilityService.ts) but were never defined in this migration
--    history -- they only existed in the deployed database, outside version
--    control, with unknown logic. This migration (re)defines both, backed by
--    the same time-aware, per-unit overlap helper as the rest of the system,
--    so a fresh environment provisioned from these migrations is not missing
--    functions the shipped frontend depends on, and so the reservation
--    calendar (which was reading get_product_availability_calendar through
--    dead code -- see the companion frontend fix wiring up disabledDateKeys)
--    can never disagree with the pickup-time/quantity/checkout checks.
--
-- What was already correct and is preserved as-is: the 22-hour rental + 2-hour
-- preparation-buffer window math (reserved_window width == rental_days * 24h,
-- exactly matching pickup_at + 22h + (days-1)*24h + 2h), and the half-open
-- range overlap semantics ([pickup, blocked_end) && [existing_pickup,
-- existing_blocked_end)) that already let adjacent bookings sit back-to-back
-- once the previous booking's buffer ends.

create or replace function private.count_unit_availability(
  p_product_id uuid,
  p_window tstzrange
)
returns table (total_units bigint, available_units bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::bigint as total_units,
    count(*) filter (
      where not exists (
        select 1
        from public.unit_reservations ur
        where ur.inventory_unit_id = iu.id
          and ur.status in ('tentative', 'confirmed', 'in_use')
          and ur.reserved_window && p_window
      )
    )::bigint as available_units
  from public.inventory_units iu
  where iu.product_id = p_product_id
    and iu.lifecycle_status = 'active';
$$;

comment on function private.count_unit_availability(uuid, tstzrange) is
  'Single source of truth for per-unit time-window availability: counts active inventory_units for a product and, of those, how many have no tentative/confirmed/in_use unit_reservations row whose reserved_window overlaps p_window. Every availability RPC in the system should read through this instead of re-implementing the overlap check.';

revoke all on function private.count_unit_availability(uuid, tstzrange)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Re-point the existing time-based availability RPCs at the shared helper.
-- Signatures and returned semantics are unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.get_product_time_availability(
  p_product_id uuid,
  p_pickup_at timestamptz,
  p_quantity integer default 1
)
returns table (
  product_id uuid,
  total_units bigint,
  available_units bigint,
  unavailable_units bigint,
  next_available_at timestamptz,
  pickup_convenience_fee numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity integer := greatest(coalesce(p_quantity, 1), 1);
  v_window tstzrange := tstzrange(p_pickup_at, p_pickup_at + interval '24 hours', '[)');
  v_local_time time := (p_pickup_at at time zone 'Asia/Manila')::time;
  v_closing_at timestamptz;
  v_available_at_closing bigint := 0;
  v_counts record;
begin
  if p_pickup_at is null then
    raise exception 'PICKUP_TIME_REQUIRED';
  end if;

  select * into v_counts from private.count_unit_availability(p_product_id, v_window);
  total_units := coalesce(v_counts.total_units, 0);
  available_units := coalesce(v_counts.available_units, 0);

  product_id := p_product_id;
  unavailable_units := greatest(total_units - available_units, 0);
  next_available_at := case
    when available_units >= v_quantity then p_pickup_at
    else private.next_product_pickup_at(p_product_id, p_pickup_at, v_quantity)
  end;

  pickup_convenience_fee := 0;
  if v_local_time < time '09:00' then
    pickup_convenience_fee := 100;
  elsif v_local_time > time '19:00' then
    v_closing_at := (
      (p_pickup_at at time zone 'Asia/Manila')::date + time '19:00'
    ) at time zone 'Asia/Manila';

    select available_units into v_available_at_closing
      from private.count_unit_availability(
        p_product_id,
        tstzrange(v_closing_at, v_closing_at + interval '24 hours', '[)')
      );

    -- A later time suggested by unit availability is not a voluntary
    -- outside-hours request, so it must not receive the convenience fee.
    if v_available_at_closing >= v_quantity then
      pickup_convenience_fee := 100;
    end if;
  end if;

  return next;
end;
$$;

create or replace function public.get_product_multi_day_time_availability(
  p_product_id uuid,
  p_pickup_at timestamptz,
  p_quantity integer default 1,
  p_rental_days integer default 1
)
returns table (
  product_id uuid,
  total_units bigint,
  available_units bigint,
  unavailable_units bigint,
  next_available_at timestamptz,
  pickup_convenience_fee numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity integer := greatest(coalesce(p_quantity, 1), 1);
  v_days integer := least(greatest(coalesce(p_rental_days, 1), 1), 30);
  v_window tstzrange;
  v_local_time time := (p_pickup_at at time zone 'Asia/Manila')::time;
  v_closing_at timestamptz;
  v_available_at_closing bigint := 0;
  v_counts record;
begin
  if p_pickup_at is null then
    raise exception 'PICKUP_TIME_REQUIRED';
  end if;

  -- Width is exactly v_days * 24h: 22h use + 2h buffer for day one, plus 24h
  -- per additional selected day -- identical to the window that
  -- create_multi_day_time_based_booking() persists into reserved_window, so
  -- a unit reported available here is guaranteed available at submission
  -- time (absent a race, which the exclusion constraint still guards).
  v_window := tstzrange(
    p_pickup_at,
    p_pickup_at + make_interval(days => v_days),
    '[)'
  );

  select * into v_counts from private.count_unit_availability(p_product_id, v_window);
  total_units := coalesce(v_counts.total_units, 0);
  available_units := coalesce(v_counts.available_units, 0);

  product_id := p_product_id;
  unavailable_units := greatest(total_units - available_units, 0);
  next_available_at := case
    when available_units >= v_quantity then p_pickup_at
    else private.next_product_multi_day_pickup_at(p_product_id, p_pickup_at, v_quantity, v_days)
  end;

  pickup_convenience_fee := 0;
  if v_local_time < time '09:00' then
    pickup_convenience_fee := 100;
  elsif v_local_time > time '19:00' then
    v_closing_at := (
      (p_pickup_at at time zone 'Asia/Manila')::date + time '19:00'
    ) at time zone 'Asia/Manila';

    select available_units into v_available_at_closing
      from private.count_unit_availability(
        p_product_id,
        tstzrange(v_closing_at, v_closing_at + make_interval(days => v_days), '[)')
      );

    if v_available_at_closing >= v_quantity then
      pickup_convenience_fee := 100;
    end if;
  end if;

  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- (Re)define the two RPCs the frontend already calls for catalog snapshots
-- and calendar day-greying, backed by the same helper. Previously undefined
-- in this migration history.
-- ---------------------------------------------------------------------------

-- Live signature predates version control (returns integer columns in a
-- different order: total_units, unavailable_units, available_units) and
-- delegated to private.get_product_availability_internal(), which read the
-- legacy reserved_period column instead of the time-aware reserved_window
-- used by every other availability RPC. CREATE OR REPLACE cannot change a
-- function's OUT-parameter row type, so the old signature must be dropped
-- before this migration's version (bigint columns, canonical column order,
-- backed by private.count_unit_availability()) can replace it. No other
-- object depends on this function (verified via pg_depend), and the old
-- private.get_product_availability_internal() helper is intentionally left
-- in place rather than dropped, since this migration only owns the public
-- availability RPC surface.
drop function if exists public.get_product_availability(uuid, date, date);

create or replace function public.get_product_availability(
  p_product_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  product_id uuid,
  total_units bigint,
  available_units bigint,
  unavailable_units bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Whole-range snapshot: a unit counts as available only if it is free for
  -- the entire [start_date, end_date] span, not merely on one day within it.
  v_window tstzrange := tstzrange(
    (p_start_date::timestamp) at time zone 'Asia/Manila',
    ((p_end_date + 1)::timestamp) at time zone 'Asia/Manila',
    '[)'
  );
  v_counts record;
begin
  select * into v_counts from private.count_unit_availability(p_product_id, v_window);
  product_id := p_product_id;
  total_units := coalesce(v_counts.total_units, 0);
  available_units := coalesce(v_counts.available_units, 0);
  unavailable_units := greatest(total_units - available_units, 0);
  return next;
end;
$$;

comment on function public.get_product_availability(uuid, date, date) is
  'Whole-range availability snapshot for a product (e.g. catalog cards, single-day "today" queries). available_units reflects units free for the entire requested span. Real per-pickup-time availability for the reservation flow is get_product_multi_day_time_availability(); this is a coarser, UX-level figure.';

revoke all on function public.get_product_availability(uuid, date, date) from public;
grant execute on function public.get_product_availability(uuid, date, date) to anon, authenticated;

-- Same OUT-parameter row-type conflict as get_product_availability() above:
-- the live signature returns integer columns, this migration's version
-- returns bigint. No other object depends on this function (verified via
-- pg_depend).
drop function if exists public.get_product_availability_calendar(uuid, date, date);

create or replace function public.get_product_availability_calendar(
  p_product_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  day date,
  total_units bigint,
  available_units bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  -- generate_series(date, date, interval) returns timestamp/timestamptz, not
  -- date, so d.day is cast back to ::date before any arithmetic -- matching
  -- the (p_start_date::timestamp) / ((p_end_date + 1)::timestamp) pattern
  -- used in get_product_availability() above for the same Asia/Manila
  -- calendar-day-to-tstzrange conversion.
  select
    d.day::date as day,
    counts.total_units,
    counts.available_units
  from generate_series(p_start_date, p_end_date, interval '1 day') as d(day)
  cross join lateral private.count_unit_availability(
    p_product_id,
    tstzrange(
      (d.day::date::timestamp) at time zone 'Asia/Manila',
      ((d.day::date + 1)::timestamp) at time zone 'Asia/Manila',
      '[)'
    )
  ) as counts;
$$;

comment on function public.get_product_availability_calendar(uuid, date, date) is
  'Per-day (Asia/Manila calendar day) availability for reservation-calendar greying. A unit counts as unavailable for a day if any part of that day overlaps its reserved_window, so a day is only reported fully booked (available_units = 0) when every active unit has some conflict that day -- it does not mean every hour of the day is blocked. Backed by the same private.count_unit_availability() helper as the exact pickup-time checks, so calendar greying can never disagree with the pickup-time/quantity/checkout availability shown later in the flow.';

revoke all on function public.get_product_availability_calendar(uuid, date, date) from public;
grant execute on function public.get_product_availability_calendar(uuid, date, date) to anon, authenticated;
