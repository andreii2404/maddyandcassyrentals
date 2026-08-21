-- The reservation calendar only ever showed two states: available (green) or
-- fully booked (red), driven solely by private.count_unit_availability()
-- (any tentative/confirmed/in_use unit_reservations row overlapping the
-- day). That collapses two very different situations into one color: a date
-- held only by a booking still pending admin review (status = 'pending',
-- unit_reservations.status = 'tentative') looks identical to a date held by
-- a booking the admin has already approved/confirmed/released. The former
-- reopens automatically the moment admin_set_booking_status() rejects the
-- booking (it already flips unit_reservations to 'cancelled' -- see
-- 20260820130000_fix_booking_rejection_status.sql); the latter will not
-- reopen on its own. This migration adds one purely additive signal,
-- confirmed_unavailable_units, so the frontend can tell those two states
-- apart and render grey ("officially reserved") vs red ("temporarily
-- reserved, pending review"). It intentionally leaves the overlap/inventory
-- validation logic untouched: private.count_unit_availability() and every
-- RPC that actually gates booking (get_product_time_availability,
-- get_product_multi_day_time_availability, get_product_availability, and
-- the row-locked checks inside create_time_based_booking /
-- create_multi_item_booking) are not modified by this migration. Only
-- get_product_availability_calendar(), which exclusively feeds calendar
-- day-coloring, gains the new column.
--
-- Same OUT-parameter row-type constraint noted in
-- 20260821010000_fix_availability_overlap_and_calendar.sql applies here:
-- CREATE OR REPLACE FUNCTION cannot append a new output column to an
-- existing RETURNS TABLE function once other sessions may have cached the
-- old composite type, so the function is dropped and recreated. No other
-- object depends on this function (verified via pg_depend).
drop function if exists public.get_product_availability_calendar(uuid, date, date);

create or replace function public.get_product_availability_calendar(
  p_product_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  day date,
  total_units bigint,
  available_units bigint,
  confirmed_unavailable_units bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.day::date as day,
    counts.total_units,
    counts.available_units,
    coalesce(confirmed.confirmed_unavailable_units, 0) as confirmed_unavailable_units
  from generate_series(p_start_date, p_end_date, interval '1 day') as d(day)
  cross join lateral private.count_unit_availability(
    p_product_id,
    tstzrange(
      (d.day::date::timestamp) at time zone 'Asia/Manila',
      ((d.day::date + 1)::timestamp) at time zone 'Asia/Manila',
      '[)'
    )
  ) as counts
  cross join lateral (
    -- Of the units blocking this day, how many are held by a booking already
    -- approved/confirmed/ready_for_release/released by admin (as opposed to
    -- still 'pending' review). Read-only, additive to counts above -- does
    -- not change available_units/total_units or which units are considered
    -- booked, only labels *why* a booked unit is booked.
    select count(distinct ur.inventory_unit_id) as confirmed_unavailable_units
    from public.unit_reservations ur
    join public.inventory_units iu on iu.id = ur.inventory_unit_id
    join public.booking_items bi on bi.id = ur.booking_item_id
    join public.bookings b on b.id = bi.booking_id
    where iu.product_id = p_product_id
      and iu.lifecycle_status = 'active'
      and ur.status in ('tentative', 'confirmed', 'in_use')
      and ur.reserved_window && tstzrange(
        (d.day::date::timestamp) at time zone 'Asia/Manila',
        ((d.day::date + 1)::timestamp) at time zone 'Asia/Manila',
        '[)'
      )
      and b.status in ('approved', 'confirmed', 'ready_for_release', 'released')
  ) as confirmed;
$$;

comment on function public.get_product_availability_calendar(uuid, date, date) is
  'Per-day (Asia/Manila calendar day) availability for reservation-calendar coloring. available_units = 0 means the day is fully held (render red or grey); confirmed_unavailable_units counts how many of the blocking unit_reservations belong to a booking already approved/confirmed/ready_for_release/released by admin, so the frontend can render grey ("officially reserved, will not reopen on its own") instead of red ("pending review, still cancellable/rejectable and would free this date") without changing what counts as bookable -- that remains private.count_unit_availability(), driven only by unit_reservations.status.';

revoke all on function public.get_product_availability_calendar(uuid, date, date) from public;
grant execute on function public.get_product_availability_calendar(uuid, date, date) to anon, authenticated;
