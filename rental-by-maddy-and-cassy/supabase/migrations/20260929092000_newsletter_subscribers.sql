begin;

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  consented_at timestamptz not null default now(),
  status text not null default 'subscribed' check (status in ('subscribed', 'unsubscribed')),
  unsubscribed_at timestamptz,
  unsubscribe_token uuid not null default gen_random_uuid(),
  source text,
  customer_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint newsletter_subscribers_email_unique unique (email)
);

create unique index newsletter_subscribers_token_idx on public.newsletter_subscribers (unsubscribe_token);

alter table public.newsletter_subscribers enable row level security;

create policy admins_read_newsletter_subscribers
on public.newsletter_subscribers for select
to authenticated
using ((select private.is_admin()));

revoke all on table public.newsletter_subscribers from anon, authenticated;
grant select on table public.newsletter_subscribers to authenticated;
grant all on table public.newsletter_subscribers to service_role;

create or replace function public.subscribe_newsletter(p_email text, p_source text default null)
returns table (already_subscribed boolean, unsubscribe_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_uid uuid;
  v_was_subscribed boolean;
  v_token uuid;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  v_uid := auth.uid();

  select (status = 'subscribed') into v_was_subscribed
  from public.newsletter_subscribers where email = v_email;

  insert into public.newsletter_subscribers (email, source, customer_id)
  values (v_email, nullif(p_source, ''), v_uid)
  on conflict (email) do update set
    status = 'subscribed',
    unsubscribed_at = null,
    consented_at = now(),
    source = coalesce(public.newsletter_subscribers.source, excluded.source),
    customer_id = coalesce(public.newsletter_subscribers.customer_id, excluded.customer_id)
  returning public.newsletter_subscribers.unsubscribe_token into v_token;

  return query select coalesce(v_was_subscribed, false), v_token;
end;
$$;

revoke all on function public.subscribe_newsletter(text, text) from public;
grant execute on function public.subscribe_newsletter(text, text) to anon, authenticated;

create or replace function public.unsubscribe_newsletter(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.newsletter_subscribers
  set status = 'unsubscribed', unsubscribed_at = now()
  where unsubscribe_token = p_token and status = 'subscribed';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.unsubscribe_newsletter(uuid) from public;
grant execute on function public.unsubscribe_newsletter(uuid) to anon, authenticated;

commit;
