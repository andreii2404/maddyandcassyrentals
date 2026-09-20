begin;

do $$
declare
  v_payment record;
  v_result jsonb;
  v_status public.payment_submission_status;
begin
  select
    payment.id,
    payment.booking_id
  into v_payment
  from public.booking_payment_submissions payment
  where payment.status in ('submitted', 'under_review')
  order by payment.created_at
  limit 1;

  if v_payment.id is null then
    raise exception 'TEST_REQUIRES_A_PENDING_PAYMENT';
  end if;

  v_result := public.review_manual_payment(
    v_payment.booking_id,
    v_payment.id,
    'rejected',
    null,
    'Automated rollback-only rejection test',
    null,
    null,
    '{}'::jsonb,
    'Automated Reviewer'
  );

  select status into v_status
  from public.booking_payment_submissions
  where id = v_payment.id;

  if v_status <> 'rejected' then
    raise exception 'EXPECTED_REJECTED_STATUS, got %', v_status;
  end if;

  if v_result ->> 'status' <> 'rejected' then
    raise exception 'EXPECTED_REJECTED_RESULT, got %', v_result;
  end if;

  if not exists (
    select 1
    from public.booking_payment_submissions
    where id = v_payment.id
      and reviewer_name = 'Automated Reviewer'
  ) then
    raise exception 'EXPECTED_CUSTOM_REVIEWER_NAME_TO_PERSIST';
  end if;

  begin
    perform public.review_manual_payment(
      v_payment.booking_id,
      v_payment.id,
      'verified',
      null,
      null,
      null,
      null,
      '{}'::jsonb
    );
    raise exception 'EXPECTED_DUPLICATE_REVIEW_TO_FAIL';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'PAYMENT_ALREADY_REVIEWED' then
        raise;
      end if;
  end;
end;
$$;

do $$
declare
  v_payment record;
  v_result jsonb;
  v_status public.payment_submission_status;
  v_paid numeric;
  v_paid_before numeric;
  v_total numeric;
begin
  select payment.id, payment.booking_id, payment.external_reference
  into v_payment
  from public.booking_payment_submissions payment
  join public.booking_totals totals on totals.booking_id = payment.booking_id
  where payment.status in ('submitted', 'under_review')
    and not exists (
      select 1
      from public.booking_payment_submissions verified
      where verified.id <> payment.id
        and verified.status = 'verified'
        and verified.external_reference = payment.external_reference
    )
    and (
      select coalesce(sum(existing.declared_amount), 0)
      from public.booking_payment_submissions existing
      where existing.booking_id = payment.booking_id
        and existing.status = 'verified'
    ) < totals.total_amount - 0.01
  order by payment.created_at
  limit 1;

  if v_payment.id is null then
    raise exception 'TEST_REQUIRES_A_VERIFIABLE_PENDING_PAYMENT';
  end if;

  select totals.total_amount,
         coalesce(sum(existing.declared_amount) filter (where existing.status = 'verified'), 0)
  into v_total, v_paid_before
  from public.booking_totals totals
  left join public.booking_payment_submissions existing on existing.booking_id = totals.booking_id
  where totals.booking_id = v_payment.booking_id
  group by totals.total_amount;

  -- Reproduce the stale-balance case: another review may have reduced the
  -- remaining balance since this pending submission was created.
  update public.booking_payment_submissions
  set declared_amount = (v_total - v_paid_before) + 100
  where id = v_payment.id;

  v_result := public.review_manual_payment(
    v_payment.booking_id,
    v_payment.id,
    'verified',
    null,
    null,
    coalesce(v_payment.external_reference, v_payment.id::text),
    'gcash',
    '{"test":true}'::jsonb
  );

  select status into v_status
  from public.booking_payment_submissions
  where id = v_payment.id;

  select coalesce(sum(declared_amount), 0)
  into v_paid
  from public.booking_payment_submissions
  where booking_id = v_payment.booking_id
    and status = 'verified';

  if v_status <> 'verified' then
    raise exception 'EXPECTED_VERIFIED_STATUS, got %', v_status;
  end if;

  if (v_result ->> 'verifiedAmount')::numeric <> v_paid then
    raise exception 'EXPECTED_AUTHORITATIVE_VERIFIED_AMOUNT, got % versus %', v_result, v_paid;
  end if;

  if (v_result ->> 'appliedAmount')::numeric <> v_total - v_paid_before
     or (v_result ->> 'remainingBalance')::numeric <> 0
     or (v_result ->> 'fullyPaid')::boolean is not true then
    raise exception 'EXPECTED_STALE_AMOUNT_TO_BE_CAPPED_AT_BALANCE, got %', v_result;
  end if;

  begin
    perform public.review_manual_payment(
      v_payment.booking_id,
      v_payment.id,
      'verified',
      null,
      null,
      coalesce(v_payment.external_reference, v_payment.id::text),
      'gcash',
      '{}'::jsonb
    );
    raise exception 'EXPECTED_DUPLICATE_VERIFICATION_TO_FAIL';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'PAYMENT_ALREADY_REVIEWED' then
        raise;
      end if;
  end;
end;
$$;

rollback;
