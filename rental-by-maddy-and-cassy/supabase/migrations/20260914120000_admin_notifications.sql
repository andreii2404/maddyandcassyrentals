begin;

-- Notifications addressed to administrators are separate from customer
-- notifications so a customer cannot read or mark an admin alert as read.
create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  notification_type text not null,
  title text not null,
  message text not null,
  action_url text,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_notifications_user_created_idx
  on public.admin_notifications (admin_user_id, created_at desc);

alter table public.admin_notifications enable row level security;

drop policy if exists admins_read_own_notifications on public.admin_notifications;
create policy admins_read_own_notifications
on public.admin_notifications for select
to authenticated
using (admin_user_id = (select auth.uid()) and (select private.is_admin()));

drop policy if exists admins_update_own_notifications on public.admin_notifications;
create policy admins_update_own_notifications
on public.admin_notifications for update
to authenticated
using (admin_user_id = (select auth.uid()) and (select private.is_admin()))
with check (admin_user_id = (select auth.uid()) and (select private.is_admin()));

revoke all on table public.admin_notifications from anon, authenticated;
grant select, update on table public.admin_notifications to authenticated;
grant all on table public.admin_notifications to service_role;

commit;
