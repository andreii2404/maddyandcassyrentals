alter table public.bookings
  add column if not exists balance_payment_preference text not null default 'online_gcash',
  add column if not exists balance_preference_updated_at timestamptz,
  add column if not exists pay_later_allowed boolean not null default false,
  add column if not exists pay_later_allowed_by uuid,
  add column if not exists pay_later_allowed_at timestamptz,
  add column if not exists pay_later_note text;

alter table public.bookings
  drop constraint if exists bookings_balance_payment_preference_check;

alter table public.bookings
  add constraint bookings_balance_payment_preference_check
  check (balance_payment_preference in ('online_gcash', 'in_person'));

comment on column public.bookings.balance_payment_preference is
  'Customer-selected channel for settling the remaining booking balance.';
comment on column public.bookings.pay_later_allowed is
  'Explicit administrator override allowing handover before the balance is fully paid.';

create or replace function private.enforce_booking_payment_before_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total numeric := 0;
  v_paid numeric := 0;
begin
  if new.status = 'released'
     and old.status is distinct from new.status
     and not coalesce(new.pay_later_allowed, false) then
    select coalesce(bt.total_amount, 0)
      into v_total
    from public.booking_totals bt
    where bt.booking_id = new.id;

    select coalesce(sum(bps.declared_amount), 0)
      into v_paid
    from public.booking_payment_submissions bps
    where bps.booking_id = new.id
      and bps.status = 'verified';

    if v_paid < v_total - 0.01 then
      raise exception 'BALANCE_PAYMENT_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_booking_payment_before_release on public.bookings;
create trigger enforce_booking_payment_before_release
before update of status on public.bookings
for each row
execute function private.enforce_booking_payment_before_release();
