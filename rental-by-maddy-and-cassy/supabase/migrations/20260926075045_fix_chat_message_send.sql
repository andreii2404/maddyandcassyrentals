-- Fixes customer/admin chat sends failing with:
--   column reference "conversation_id" is ambiguous
--
-- RETURNS TABLE exposes conversation_id and client_message_id as PL/pgSQL
-- variables. Referencing those names in ON CONFLICT therefore clashes with the
-- chat_messages columns. Target the named unique constraint instead. The return
-- row also must not depend on a profiles row because guest users may not have
-- one until they provide booking/contact details.

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
  to authenticated, service_role;
