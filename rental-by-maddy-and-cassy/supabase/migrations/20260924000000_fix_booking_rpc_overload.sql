-- PostgREST cannot choose between the legacy 14-argument booking RPC and the
-- variant-aware 15-argument RPC when the final argument is omitted. The
-- variant-aware function already has p_variant defaulted to null, so the
-- legacy wrapper is redundant and makes normal booking submissions fail with
-- PGRST203.

drop function if exists public.create_multi_day_time_based_booking(
  uuid, timestamptz, text, text, text, numeric, numeric, jsonb, jsonb,
  jsonb, text, text, integer, integer
);

notify pgrst, 'reload schema';
