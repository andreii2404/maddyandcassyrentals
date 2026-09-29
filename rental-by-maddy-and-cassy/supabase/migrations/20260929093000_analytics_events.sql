begin;

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'product_view', 'search', 'add_to_cart', 'checkout_start',
    'booking_completed', 'promotion_applied', 'newsletter_signup'
  )),
  session_id text not null,
  customer_id uuid references auth.users(id) on delete set null,
  is_guest boolean not null default false,
  product_id uuid references public.products(id) on delete set null,
  promotion_id uuid references public.promotions(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index analytics_events_type_created_idx on public.analytics_events (event_type, created_at desc);
create index analytics_events_session_idx on public.analytics_events (session_id);

alter table public.analytics_events enable row level security;

create policy admins_read_analytics_events
on public.analytics_events for select
to authenticated
using ((select private.is_admin()));

revoke all on table public.analytics_events from anon, authenticated;
grant select on table public.analytics_events to authenticated;
grant all on table public.analytics_events to service_role;

create or replace function public.log_marketing_event(
  p_event_type text,
  p_session_id text,
  p_product_id uuid default null,
  p_promotion_id uuid default null,
  p_booking_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_term text default null,
  p_utm_content text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_is_guest boolean;
  v_session_id text;
begin
  if p_event_type not in (
    'product_view', 'search', 'add_to_cart', 'checkout_start',
    'booking_completed', 'promotion_applied', 'newsletter_signup'
  ) then
    raise exception 'INVALID_EVENT_TYPE';
  end if;

  v_session_id := nullif(trim(coalesce(p_session_id, '')), '');
  if v_session_id is null then
    raise exception 'SESSION_ID_REQUIRED';
  end if;

  v_uid := auth.uid();
  select coalesce(u.is_anonymous, v_uid is null) into v_is_guest
  from auth.users u where u.id = v_uid;
  v_is_guest := coalesce(v_is_guest, true);

  insert into public.analytics_events (
    event_type, session_id, customer_id, is_guest, product_id, promotion_id,
    booking_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, metadata
  )
  values (
    p_event_type, left(v_session_id, 100), v_uid, v_is_guest, p_product_id, p_promotion_id,
    p_booking_id, nullif(p_utm_source, ''), nullif(p_utm_medium, ''), nullif(p_utm_campaign, ''),
    nullif(p_utm_term, ''), nullif(p_utm_content, ''), coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.log_marketing_event(
  text, text, uuid, uuid, uuid, jsonb, text, text, text, text, text
) from public;
grant execute on function public.log_marketing_event(
  text, text, uuid, uuid, uuid, jsonb, text, text, text, text, text
) to anon, authenticated;

commit;
