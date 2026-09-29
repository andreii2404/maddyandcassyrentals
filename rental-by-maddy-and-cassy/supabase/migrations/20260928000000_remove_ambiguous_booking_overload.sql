-- The variant-aware booking RPC has p_variant as its final argument. The
-- previous 14-argument overload remained alongside it, so calls that omitted
-- p_variant could fail with PostgREST PGRST203 before the function ran.
drop function if exists public.create_multi_day_time_based_booking(
  uuid, timestamptz, text, text, text, numeric, numeric, jsonb, jsonb, jsonb,
  text, text, integer, integer
);
