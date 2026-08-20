-- Enforce a minimum age of 18 for customer accounts. Previously only the
-- birth_date range (1900-01-01..today) was validated, which let underage
-- signups through. This tightens the profile CHECK constraint and rejects
-- registration outright when the submitted birthdate implies age < 18,
-- instead of silently discarding it as handle_new_auth_user() used to.

alter table public.profiles
  drop constraint profiles_birth_date_reasonable;

alter table public.profiles
  add constraint profiles_birth_date_reasonable
  check (
    birth_date is null
    or (
      birth_date >= date '1900-01-01'
      and birth_date <= (current_date - interval '18 years')::date
    )
  );

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_first_name text := nullif(new.raw_user_meta_data ->> 'first_name', '');
  v_last_name text := nullif(new.raw_user_meta_data ->> 'last_name', '');
  v_phone_number text := nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone_number', ''), '[^0-9]', '', 'g'), '');
  v_birth_date date;
  v_display_name text;
begin
  v_display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(trim(concat_ws(' ', v_first_name, v_last_name)), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Customer'
  );

  if v_phone_number is not null and v_phone_number !~ '^[0-9]{11}$' then
    v_phone_number := null;
  end if;

  begin
    v_birth_date := nullif(new.raw_user_meta_data ->> 'birth_date', '')::date;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      v_birth_date := null;
  end;

  if v_birth_date is not null
    and (v_birth_date < date '1900-01-01' or v_birth_date > current_date)
  then
    v_birth_date := null;
  end if;

  if v_birth_date is not null and v_birth_date > (current_date - interval '18 years')::date then
    raise exception 'UNDERAGE_BIRTH_DATE' using errcode = '23514';
  end if;

  insert into public.profiles (
    id,
    contact_email,
    first_name,
    last_name,
    display_name,
    phone_number,
    birth_date
  )
  values (
    new.id,
    new.email,
    v_first_name,
    v_last_name,
    v_display_name,
    v_phone_number,
    v_birth_date
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'customer')
  on conflict (user_id, role) do nothing;

  return new;
end;
$function$;
