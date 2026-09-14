-- The admin Payments page subscribes to Postgres Changes on this table so submit /
-- verify / reject / proof-upload actions appear instantly without polling. Postgres
-- Changes respects the existing booking_payment_submissions RLS policies, so this
-- only broadcasts rows the subscribing admin could already select.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'booking_payment_submissions'
  ) then
    alter publication supabase_realtime add table public.booking_payment_submissions;
  end if;
end
$$;
