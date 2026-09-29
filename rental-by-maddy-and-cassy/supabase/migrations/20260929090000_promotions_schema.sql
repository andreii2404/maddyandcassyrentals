begin;

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  title text not null,
  description text,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value numeric(12,2) not null check (discount_value > 0),
  max_discount_amount numeric(12,2) check (max_discount_amount is null or max_discount_amount > 0),
  min_subtotal numeric(12,2) not null default 0 check (min_subtotal >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default true,
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  per_customer_limit integer not null default 1 check (per_customer_limit > 0),
  current_uses integer not null default 0 check (current_uses >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_code_unique unique (code),
  constraint promotions_date_window_valid check (ends_at > starts_at),
  constraint promotions_percentage_bounded check (
    discount_type <> 'percentage' or discount_value <= 100
  )
);

create index promotions_active_window_idx
  on public.promotions (is_active, starts_at, ends_at);

alter table public.promotions enable row level security;

create policy admins_manage_promotions
on public.promotions for all
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

revoke all on table public.promotions from anon, authenticated;
grant select, insert, update on table public.promotions to authenticated;
grant all on table public.promotions to service_role;

create table public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  customer_id uuid references auth.users(id) on delete set null,
  discount_amount numeric(12,2) not null check (discount_amount >= 0),
  created_at timestamptz not null default now(),
  constraint promotion_redemptions_booking_unique unique (booking_id)
);

create index promotion_redemptions_promotion_customer_idx
  on public.promotion_redemptions (promotion_id, customer_id);

alter table public.promotion_redemptions enable row level security;

create policy admins_read_promotion_redemptions
on public.promotion_redemptions for select
to authenticated
using ((select private.is_admin()));

revoke all on table public.promotion_redemptions from anon, authenticated;
grant select on table public.promotion_redemptions to authenticated;
grant all on table public.promotion_redemptions to service_role;

-- Safe public read surface: only currently-active, in-window promotions,
-- and only the columns a storefront banner or checkout preview needs.
-- Runs with the view owner's privileges (no security_invoker), so it
-- intentionally bypasses the admin-only RLS above for these columns only.
create view public.active_promotions as
select id, code, title, description, discount_type, discount_value,
  max_discount_amount, min_subtotal, ends_at
from public.promotions
where is_active = true
  and now() >= starts_at
  and now() <= ends_at;

grant select on public.active_promotions to anon, authenticated;

create or replace function public.preview_promotion(p_code text, p_subtotal numeric)
returns table (valid boolean, reason text, discount_amount numeric, promotion_id uuid, title text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_promo public.promotions;
  v_base numeric;
  v_discount numeric := 0;
  v_uid uuid;
  v_customer_uses integer := 0;
begin
  v_code := upper(trim(coalesce(p_code, '')));
  v_base := greatest(coalesce(p_subtotal, 0), 0);
  v_uid := auth.uid();

  if v_code = '' then
    return query select false, 'INVALID_CODE', 0::numeric, null::uuid, null::text;
    return;
  end if;

  select p.* into v_promo from public.promotions p where upper(p.code) = v_code;

  if v_promo.id is null then
    return query select false, 'NOT_FOUND', 0::numeric, null::uuid, null::text;
    return;
  end if;
  if not v_promo.is_active then
    return query select false, 'INACTIVE', 0::numeric, v_promo.id, v_promo.title;
    return;
  end if;
  if now() < v_promo.starts_at then
    return query select false, 'NOT_STARTED', 0::numeric, v_promo.id, v_promo.title;
    return;
  end if;
  if now() > v_promo.ends_at then
    return query select false, 'EXPIRED', 0::numeric, v_promo.id, v_promo.title;
    return;
  end if;
  if v_base < v_promo.min_subtotal then
    return query select false, 'MIN_SUBTOTAL_NOT_MET', 0::numeric, v_promo.id, v_promo.title;
    return;
  end if;
  if v_promo.usage_limit is not null and v_promo.current_uses >= v_promo.usage_limit then
    return query select false, 'USAGE_LIMIT_REACHED', 0::numeric, v_promo.id, v_promo.title;
    return;
  end if;

  if v_uid is not null then
    select count(*)::integer into v_customer_uses
    from public.promotion_redemptions r
    where r.promotion_id = v_promo.id and r.customer_id = v_uid;
    if v_customer_uses >= v_promo.per_customer_limit then
      return query select false, 'CUSTOMER_LIMIT_REACHED', 0::numeric, v_promo.id, v_promo.title;
      return;
    end if;
  end if;

  if v_promo.discount_type = 'percentage' then
    v_discount := round(v_base * v_promo.discount_value / 100, 2);
    if v_promo.max_discount_amount is not null then
      v_discount := least(v_discount, v_promo.max_discount_amount);
    end if;
  else
    v_discount := v_promo.discount_value;
  end if;
  v_discount := least(v_discount, v_base);

  return query select true, null::text, v_discount, v_promo.id, v_promo.title;
end;
$$;

revoke all on function public.preview_promotion(text, numeric) from public;
grant execute on function public.preview_promotion(text, numeric) to anon, authenticated;

commit;
