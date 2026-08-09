-- Seed the verified registration name and phone number into the customer
-- profile when Supabase creates a new auth user. Authorization remains based
-- on public.user_roles; user-supplied metadata is never used for access.
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

  insert into public.profiles (
    id,
    contact_email,
    first_name,
    last_name,
    display_name,
    phone_number
  )
  values (
    new.id,
    new.email,
    v_first_name,
    v_last_name,
    v_display_name,
    v_phone_number
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'customer')
  on conflict (user_id, role) do nothing;

  return new;
end;
$function$;
