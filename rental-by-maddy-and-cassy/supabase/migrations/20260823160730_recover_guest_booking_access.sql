-- Restore a guest booking into a new anonymous session after the original
-- browser session is unavailable. Recovery requires all three checkout
-- identifiers and never converts the booking into a loyalty-bearing account
-- booking.

create or replace function private.recover_guest_booking_access(
  p_target_user_id uuid,
  p_booking_reference text,
  p_email text,
  p_phone_number text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := p_target_user_id;
  v_reference text := upper(trim(both from coalesce(p_booking_reference, '')));
  v_email text := lower(trim(both from coalesce(p_email, '')));
  v_phone text := regexp_replace(coalesce(p_phone_number, ''), '[^0-9]', '', 'g');
  v_booking_id uuid;
  v_previous_customer_id uuid;
  v_display_name text;
  v_contact_email text;
  v_profile_phone text;
  v_full_address text;
  v_facebook_url text;
  v_instagram_url text;
begin
  if v_uid is null or not exists (
    select 1 from auth.users as target_user
    where target_user.id = v_uid
      and target_user.is_anonymous is true
  ) then
    raise exception 'ANONYMOUS_SESSION_REQUIRED' using errcode = '28000';
  end if;

  if v_reference !~ '^BK-[A-Z0-9]{6,20}$'
    or length(v_email) > 254
    or v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
    or v_phone !~ '^[0-9]{11}$'
  then
    raise exception 'GUEST_BOOKING_NOT_FOUND';
  end if;

  select
    booking.id,
    booking.customer_id,
    profile.display_name,
    profile.contact_email,
    profile.phone_number,
    profile.full_address,
    profile.facebook_url,
    profile.instagram_url
  into
    v_booking_id,
    v_previous_customer_id,
    v_display_name,
    v_contact_email,
    v_profile_phone,
    v_full_address,
    v_facebook_url,
    v_instagram_url
  from public.bookings as booking
  join public.profiles as profile on profile.id = booking.customer_id
  join auth.users as customer on customer.id = booking.customer_id
  where upper(booking.booking_reference) = v_reference
    and booking.is_guest_checkout is true
    and customer.is_anonymous is true
    and lower(coalesce(profile.contact_email, '')) = v_email
    and regexp_replace(coalesce(profile.phone_number, ''), '[^0-9]', '', 'g') = v_phone
  for update of booking;

  if v_booking_id is null then
    raise exception 'GUEST_BOOKING_NOT_FOUND';
  end if;

  if v_previous_customer_id <> v_uid then
    update public.profiles
    set
      display_name = v_display_name,
      contact_email = v_contact_email,
      phone_number = v_profile_phone,
      full_address = v_full_address,
      facebook_url = v_facebook_url,
      instagram_url = v_instagram_url,
      is_guest_contact = true,
      updated_at = now()
    where id = v_uid;

    if not found then
      raise exception 'CUSTOMER_PROFILE_REQUIRED';
    end if;

    update public.bookings
    set customer_id = v_uid, updated_at = now()
    where id = v_booking_id
      and customer_id = v_previous_customer_id
      and is_guest_checkout is true;

    if not found then
      raise exception 'GUEST_BOOKING_RECOVERY_CONFLICT';
    end if;

    update public.notifications
    set user_id = v_uid
    where booking_id = v_booking_id
      and user_id = v_previous_customer_id;
  end if;

  return v_booking_id;
end;
$$;

revoke all on function private.recover_guest_booking_access(uuid, text, text, text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.recover_guest_booking_access(uuid, text, text, text) to service_role;

create or replace function public.recover_guest_booking_access(
  p_target_user_id uuid,
  p_booking_reference text,
  p_email text,
  p_phone_number text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.recover_guest_booking_access(
    p_target_user_id,
    p_booking_reference,
    p_email,
    p_phone_number
  );
$$;

revoke all on function public.recover_guest_booking_access(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.recover_guest_booking_access(uuid, text, text, text) to service_role;

comment on function public.recover_guest_booking_access(uuid, text, text, text) is
  'Restores one verified guest booking to the caller''s anonymous session using the booking reference, checkout email, and 11-digit phone number.';

-- Recovered bookings may still reference files uploaded under the original
-- anonymous user folder. Allow the new booking owner to read only files that
-- are explicitly linked to that booking.
drop policy if exists customers_read_booking_linked_documents on public.customer_documents;
create policy customers_read_booking_linked_documents
on public.customer_documents
for select
to authenticated
using (
  exists (
    select 1
    from public.booking_requirement_submissions as submission
    join public.booking_requirements as requirement
      on requirement.id = submission.booking_requirement_id
    join public.bookings as booking on booking.id = requirement.booking_id
    where submission.customer_document_id = customer_documents.id
      and booking.customer_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.booking_payment_submissions as payment
    join public.bookings as booking on booking.id = payment.booking_id
    where payment.proof_document_id = customer_documents.id
      and booking.customer_id = (select auth.uid())
  )
);

create or replace function private.customer_can_read_booking_object(
  p_bucket_id text,
  p_object_name text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.customer_documents as document
      where document.storage_bucket = p_bucket_id
        and document.storage_path = p_object_name
        and (
          exists (
            select 1
            from public.booking_requirement_submissions as submission
            join public.booking_requirements as requirement
              on requirement.id = submission.booking_requirement_id
            join public.bookings as booking on booking.id = requirement.booking_id
            where submission.customer_document_id = document.id
              and booking.customer_id = p_user_id
          )
          or exists (
            select 1
            from public.booking_payment_submissions as payment
            join public.bookings as booking on booking.id = payment.booking_id
            where payment.proof_document_id = document.id
              and booking.customer_id = p_user_id
          )
        )
    )
    or (
      p_bucket_id = 'customer-documents'
      and exists (
        select 1
        from public.agreement_signatures as signature
        join public.agreement_versions as version
          on version.id = signature.agreement_version_id
        join public.booking_agreements as agreement
          on agreement.id = version.agreement_id
        join public.bookings as booking on booking.id = agreement.booking_id
        where signature.signature_path = p_object_name
          and booking.customer_id = p_user_id
      )
    )
    or (
      p_bucket_id = 'agreements'
      and exists (
        select 1
        from public.agreement_versions as version
        join public.booking_agreements as agreement
          on agreement.id = version.agreement_id
        join public.bookings as booking on booking.id = agreement.booking_id
        where (version.generated_document_path = p_object_name
          or version.final_document_path = p_object_name)
          and booking.customer_id = p_user_id
      )
    )
    or (
      p_bucket_id = 'receipts'
      and exists (
        select 1
        from public.booking_receipts as receipt
        join public.bookings as booking on booking.id = receipt.booking_id
        where receipt.document_path = p_object_name
          and booking.customer_id = p_user_id
      )
    );
$$;

revoke all on function private.customer_can_read_booking_object(text, text, uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.customer_can_read_booking_object(text, text, uuid) to authenticated;

drop policy if exists storage_private_customer_read on storage.objects;
create policy storage_private_customer_read
on storage.objects
for select
to authenticated
using (
  bucket_id = any (
    array[
      'profile-images'::text,
      'customer-documents'::text,
      'booking-documents'::text,
      'payment-proofs'::text,
      'agreements'::text,
      'receipts'::text,
      'invoices'::text
    ]
  )
  and (
    (storage.foldername(name))[1] = ((select auth.uid()))::text
    or (select private.is_active_admin())
    or private.customer_can_read_booking_object(
      bucket_id,
      name,
      (select auth.uid())
    )
  )
);
