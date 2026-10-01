-- Customers may send at most 2 consecutive messages per conversation before
-- Maddy & Cassy Support replies. The limit is enforced inside send_chat_message
-- so refreshing the page, reopening the browser, or calling the RPC directly
-- cannot bypass it. The pending count is also exposed through
-- list_chat_conversations so the composer can be disabled before a send is
-- attempted. Admin replies reset the allowance automatically.

create or replace function private.chat_customer_message_limit()
returns integer
language sql
immutable
as $$
  select 2;
$$;

revoke all on function private.chat_customer_message_limit() from public, anon, authenticated;

-- Counts customer messages sent after the most recent admin reply in the
-- conversation. Returns the full customer message count when support has never
-- replied yet, so brand-new threads are limited too.
create or replace function private.count_pending_customer_messages(
  p_conversation_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.chat_messages as customer_message
  where customer_message.conversation_id = p_conversation_id
    and customer_message.sender_role = 'customer'
    and customer_message.created_at > coalesce(
      (
        select max(admin_message.created_at)
        from public.chat_messages as admin_message
        where admin_message.conversation_id = p_conversation_id
          and admin_message.sender_role = 'admin'
      ),
      '-infinity'::timestamptz
    );
$$;

revoke all on function private.count_pending_customer_messages(uuid)
  from public, anon, authenticated;

-- The return type gains two columns, so the old signature must be dropped first.
drop function if exists public.list_chat_conversations();

create or replace function public.list_chat_conversations()
returns table (
  id uuid,
  booking_id uuid,
  booking_reference text,
  customer_id uuid,
  customer_name text,
  customer_email text,
  is_guest boolean,
  subject text,
  status text,
  last_message_preview text,
  last_message_at timestamptz,
  unread_count bigint,
  pending_customer_messages integer,
  customer_message_limit integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
begin
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '28000';
  end if;
  v_is_admin := (select private.is_admin());

  return query
  select
    conversation.id,
    conversation.booking_id,
    booking.booking_reference,
    conversation.customer_id,
    coalesce(nullif(trim(profile.display_name), ''), 'Guest customer') as customer_name,
    profile.contact_email as customer_email,
    coalesce(auth_user.is_anonymous, profile.is_guest_contact, false) as is_guest,
    conversation.subject,
    conversation.status,
    conversation.last_message_preview,
    conversation.last_message_at,
    (
      select count(*)
      from public.chat_messages as message
      where message.conversation_id = conversation.id
        and (
          (v_is_admin and message.sender_role = 'customer'
            and message.created_at > coalesce(conversation.admin_last_read_at, '-infinity'::timestamptz))
          or
          (not v_is_admin and message.sender_role in ('admin', 'system')
            and message.created_at > coalesce(conversation.customer_last_read_at, '-infinity'::timestamptz))
        )
    ) as unread_count,
    private.count_pending_customer_messages(conversation.id) as pending_customer_messages,
    private.chat_customer_message_limit() as customer_message_limit,
    conversation.created_at
  from public.chat_conversations as conversation
  left join public.bookings as booking on booking.id = conversation.booking_id
  left join public.profiles as profile on profile.id = conversation.customer_id
  left join auth.users as auth_user on auth_user.id = conversation.customer_id
  where v_is_admin
     or conversation.customer_id = v_uid
     or booking.customer_id = v_uid
  order by conversation.last_message_at desc nulls last, conversation.created_at desc;
end;
$$;

revoke all on function public.list_chat_conversations() from public, anon, authenticated;
grant execute on function public.list_chat_conversations() to authenticated;
grant execute on function public.list_chat_conversations() to service_role;

create or replace function public.send_chat_message(
  p_conversation_id uuid,
  p_body text,
  p_client_message_id uuid
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  sender_role text,
  sender_name text,
  message_type text,
  body text,
  created_at timestamptz,
  edited_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_role text;
  v_body text := trim(coalesce(p_body, ''));
  v_message public.chat_messages;
  v_conversation public.chat_conversations;
  v_sender_name text;
  v_existing_message_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '28000';
  end if;
  if length(v_body) < 1 or length(v_body) > 2000 then
    raise exception 'INVALID_MESSAGE';
  end if;
  if p_client_message_id is null then
    raise exception 'MESSAGE_ID_REQUIRED';
  end if;

  if (
    select count(*)
    from public.chat_messages as recent_message
    where recent_message.sender_id = v_uid
      and recent_message.created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'CHAT_RATE_LIMIT';
  end if;

  select conversation.*
  into v_conversation
  from public.chat_conversations as conversation
  where conversation.id = p_conversation_id
  for update;

  if v_conversation.id is null
    or not private.can_access_chat_conversation(p_conversation_id, v_uid)
  then
    raise exception 'CHAT_ACCESS_DENIED' using errcode = '42501';
  end if;
  if v_conversation.status <> 'open' then
    raise exception 'CHAT_CLOSED';
  end if;

  v_is_admin := (select private.is_admin());
  v_role := case when v_is_admin then 'admin' else 'customer' end;

  -- A retry reuses the same client_message_id, so an already stored message must
  -- never be rejected by the consecutive-message allowance.
  select stored_message.id
  into v_existing_message_id
  from public.chat_messages as stored_message
  where stored_message.conversation_id = p_conversation_id
    and stored_message.client_message_id = p_client_message_id;

  -- The row lock taken above serialises concurrent sends on the same
  -- conversation, so this count cannot be raced past the limit.
  if not v_is_admin
    and v_existing_message_id is null
    and private.count_pending_customer_messages(p_conversation_id)
      >= private.chat_customer_message_limit()
  then
    raise exception 'CHAT_REPLY_REQUIRED';
  end if;

  insert into public.chat_messages as inserted_message (
    conversation_id,
    sender_id,
    sender_role,
    message_type,
    body,
    client_message_id
  ) values (
    p_conversation_id,
    v_uid,
    v_role,
    'text',
    v_body,
    p_client_message_id
  )
  on conflict on constraint chat_messages_client_key do update
    set client_message_id = excluded.client_message_id
  returning inserted_message.* into v_message;

  update public.chat_conversations
  set
    last_message_preview = left(v_body, 180),
    last_message_at = v_message.created_at,
    updated_at = now(),
    customer_last_read_at = case when v_is_admin then customer_last_read_at else now() end,
    admin_last_read_at = case when v_is_admin then now() else admin_last_read_at end
  where chat_conversations.id = p_conversation_id;

  select case
    when v_is_admin then 'Maddy & Cassy Support'
    else coalesce(nullif(trim(profile.display_name), ''), 'Guest customer')
  end
  into v_sender_name
  from (values (1)) as singleton(value)
  left join public.profiles as profile on profile.id = v_uid;

  return query
  select
    v_message.id,
    v_message.conversation_id,
    v_message.sender_id,
    v_message.sender_role,
    v_sender_name,
    v_message.message_type,
    v_message.body,
    v_message.created_at,
    v_message.edited_at;
end;
$$;

revoke all on function public.send_chat_message(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.send_chat_message(uuid, text, uuid)
  to authenticated;
grant execute on function public.send_chat_message(uuid, text, uuid)
  to service_role;

comment on function private.count_pending_customer_messages(uuid) is
  'Consecutive customer messages in a conversation since the latest admin reply.';
comment on function private.chat_customer_message_limit() is
  'Maximum consecutive customer messages allowed before support replies.';
