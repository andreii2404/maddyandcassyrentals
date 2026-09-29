-- A booking notification is one logical event even when its producer or
-- Supabase webhook is retried. Keep the event identity in the queue so the
-- application and Edge Function can both enforce the same boundary.
alter table if exists public.email_notifications
  add column if not exists event_key text;

update public.email_notifications
set event_key = 'legacy-' || id::text
where event_key is null;

alter table if exists public.email_notifications
  alter column event_key set not null;

create unique index if not exists email_notifications_event_key_uidx
  on public.email_notifications (event_key);

alter table if exists public.email_notifications
  add column if not exists claimed_at timestamptz;

alter table if exists public.email_notifications
  add column if not exists attempt_count integer not null default 0;

comment on column public.email_notifications.event_key is
  'Stable producer event identity; duplicate queue inserts must not create another email.';

comment on column public.email_notifications.claimed_at is
  'Timestamp when the Edge Function claimed this row for delivery.';
