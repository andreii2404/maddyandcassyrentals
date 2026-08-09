-- Booking status screens depend on this table for live refreshes. Postgres
-- Changes respects the existing bookings RLS policies: customers can select
-- only customer_id = auth.uid(), while active admins use private.is_admin().
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
end
$$;
