-- Secure in-app customer support messaging for registered and anonymous users.
-- Anonymous Supabase users keep the same authenticated/RLS protections as
-- registered users without creating a permanent customer account.

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  subject text not null default 'Rental support',
  status text not null default 'open',
  last_message_preview text,
  last_message_at timestamptz,
  customer_last_read_at timestamptz,
  admin_last_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_conversations_status_check check (status in ('open', 'closed')),
  constraint chat_conversations_subject_check check (length(trim(subject)) between 1 and 120)
);

create unique index if not exists chat_conversations_customer_general_key
  on public.chat_conversations (customer_id)
  where booking_id is null;

create unique index if not exists chat_conversations_booking_key
  on public.chat_conversations (booking_id)
  where booking_id is not null;

create index if not exists chat_conversations_last_message_idx
  on public.chat_conversations (last_message_at desc nulls last, created_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_role text not null,
  message_type text not null default 'text',
  body text not null,
  client_message_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint chat_messages_sender_role_check check (sender_role in ('customer', 'admin', 'system')),
  constraint chat_messages_type_check check (message_type in ('text', 'system')),
  constraint chat_messages_body_check check (length(trim(body)) between 1 and 2000),
  constraint chat_messages_sender_check check (
    (sender_role = 'system' and sender_id is null)
    or (sender_role in ('customer', 'admin') and sender_id is not null)
  ),
  constraint chat_messages_client_key unique (conversation_id, client_message_id)
);

create index if not exists chat_messages_conversation_created_idx
  on public.chat_messages (conversation_id, created_at, id);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists chat_conversations_participant_read on public.chat_conversations;
create policy chat_conversations_participant_read
on public.chat_conversations for select to authenticated
using (
  customer_id = (select auth.uid())
  or exists (
    select 1
    from public.bookings as booking
    where booking.id = chat_conversations.booking_id
      and booking.customer_id = (select auth.uid())
  )
  or (select private.is_admin())
);

drop policy if exists chat_messages_participant_read on public.chat_messages;
create policy chat_messages_participant_read
on public.chat_messages for select to authenticated
using (
  exists (
    select 1
    from public.chat_conversations as conversation
    where conversation.id = chat_messages.conversation_id
      and (
        conversation.customer_id = (select auth.uid())
        or exists (
          select 1
          from public.bookings as booking
          where booking.id = conversation.booking_id
            and booking.customer_id = (select auth.uid())
        )
        or (select private.is_admin())
      )
  )
);

-- New Data API security defaults require explicit grants. Mutations are only
-- available through the validated RPCs below; tables themselves remain read-only.
revoke all on table public.chat_conversations from public, anon, authenticated;
revoke all on table public.chat_messages from public, anon, authenticated;
grant select on table public.chat_conversations to authenticated;
grant select on table public.chat_messages to authenticated;
grant all on table public.chat_conversations to service_role;
grant all on table public.chat_messages to service_role;

create or replace function private.can_access_chat_conversation(
  p_conversation_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_conversations as conversation
    left join public.bookings as booking on booking.id = conversation.booking_id
    where conversation.id = p_conversation_id
      and (
        conversation.customer_id = p_user_id
        or booking.customer_id = p_user_id
        or (select private.is_admin())
      )
  );
$$;

revoke all on function private.can_access_chat_conversation(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.get_or_create_chat_conversation(
  p_booking_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_conversation_id uuid;
  v_subject text := 'Rental support';
begin
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '28000';
  end if;

  if p_booking_id is not null then
    select 'Booking ' || booking.booking_reference
    into v_subject
    from public.bookings as booking
    where booking.id = p_booking_id
      and booking.customer_id = v_uid;

    if v_subject is null then
      raise exception 'BOOKING_ACCESS_DENIED' using errcode = '42501';
    end if;

    select conversation.id
    into v_conversation_id
    from public.chat_conversations as conversation
    where conversation.booking_id = p_booking_id;

    if v_conversation_id is not null then
      -- Guest booking recovery transfers the booking to a new anonymous user.
      -- Keep the linked conversation with the recovered booking owner.
      update public.chat_conversations
      set customer_id = v_uid, updated_at = now()
      where id = v_conversation_id and customer_id <> v_uid;
      return v_conversation_id;
    end if;
  else
    select conversation.id
    into v_conversation_id
    from public.chat_conversations as conversation
    where conversation.customer_id = v_uid
      and conversation.booking_id is null;

    if v_conversation_id is not null then
      return v_conversation_id;
    end if;
  end if;

  insert into public.chat_conversations (
    customer_id,
    booking_id,
    subject,
    last_message_preview,
    last_message_at,
    customer_last_read_at
  ) values (
    v_uid,
    p_booking_id,
    v_subject,
    'Welcome! Send us a message and our rental team will reply here.',
    now(),
    now()
  )
  returning id into v_conversation_id;

  insert into public.chat_messages (
    conversation_id,
    sender_id,
    sender_role,
    message_type,
    body
  ) values (
    v_conversation_id,
    null,
    'system',
    'system',
    'Welcome! Send us a message and our rental team will reply here.'
  );

  return v_conversation_id;
exception
  when unique_violation then
    select conversation.id
    into v_conversation_id
    from public.chat_conversations as conversation
    where (p_booking_id is null and conversation.customer_id = v_uid and conversation.booking_id is null)
       or (p_booking_id is not null and conversation.booking_id = p_booking_id)
    limit 1;
    return v_conversation_id;
end;
$$;

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

create or replace function public.list_chat_messages(
  p_conversation_id uuid,
  p_limit integer default 200
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
begin
  if v_uid is null or not private.can_access_chat_conversation(p_conversation_id, v_uid) then
    raise exception 'CHAT_ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select
    message.id,
    message.conversation_id,
    message.sender_id,
    message.sender_role,
    case
      when message.sender_role = 'admin' then 'Maddy & Cassy Support'
      when message.sender_role = 'system' then 'Maddy & Cassy'
      else coalesce(nullif(trim(profile.display_name), ''), 'Guest customer')
    end as sender_name,
    message.message_type,
    message.body,
    message.created_at,
    message.edited_at
  from public.chat_messages as message
  left join public.profiles as profile on profile.id = message.sender_id
  where message.conversation_id = p_conversation_id
  order by message.created_at asc, message.id asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

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

  insert into public.chat_messages (
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
  on conflict (conversation_id, client_message_id) do update
    set client_message_id = excluded.client_message_id
  returning * into v_message;

  update public.chat_conversations
  set
    last_message_preview = left(v_body, 180),
    last_message_at = v_message.created_at,
    updated_at = now(),
    customer_last_read_at = case when v_is_admin then customer_last_read_at else now() end,
    admin_last_read_at = case when v_is_admin then now() else admin_last_read_at end
  where chat_conversations.id = p_conversation_id;

  return query
  select
    v_message.id,
    v_message.conversation_id,
    v_message.sender_id,
    v_message.sender_role,
    case
      when v_is_admin then 'Maddy & Cassy Support'
      else coalesce(nullif(trim(profile.display_name), ''), 'Guest customer')
    end,
    v_message.message_type,
    v_message.body,
    v_message.created_at,
    v_message.edited_at
  from public.profiles as profile
  where profile.id = v_uid;
end;
$$;

create or replace function public.mark_chat_conversation_read(
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
begin
  if v_uid is null or not private.can_access_chat_conversation(p_conversation_id, v_uid) then
    raise exception 'CHAT_ACCESS_DENIED' using errcode = '42501';
  end if;
  v_is_admin := (select private.is_admin());

  update public.chat_conversations
  set
    customer_last_read_at = case when v_is_admin then customer_last_read_at else now() end,
    admin_last_read_at = case when v_is_admin then now() else admin_last_read_at end,
    updated_at = updated_at
  where id = p_conversation_id;
end;
$$;

revoke all on function public.get_or_create_chat_conversation(uuid) from public, anon, authenticated;
revoke all on function public.list_chat_conversations() from public, anon, authenticated;
revoke all on function public.list_chat_messages(uuid, integer) from public, anon, authenticated;
revoke all on function public.send_chat_message(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.mark_chat_conversation_read(uuid) from public, anon, authenticated;

grant execute on function public.get_or_create_chat_conversation(uuid) to authenticated;
grant execute on function public.list_chat_conversations() to authenticated;
grant execute on function public.list_chat_messages(uuid, integer) to authenticated;
grant execute on function public.send_chat_message(uuid, text, uuid) to authenticated;
grant execute on function public.mark_chat_conversation_read(uuid) to authenticated;

grant execute on function public.get_or_create_chat_conversation(uuid) to service_role;
grant execute on function public.list_chat_conversations() to service_role;
grant execute on function public.list_chat_messages(uuid, integer) to service_role;
grant execute on function public.send_chat_message(uuid, text, uuid) to service_role;
grant execute on function public.mark_chat_conversation_read(uuid) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_conversations'
  ) then
    alter publication supabase_realtime add table public.chat_conversations;
  end if;
end;
$$;

comment on table public.chat_conversations is
  'Customer and guest support threads. Anonymous Supabase users are treated as authenticated participants.';
comment on table public.chat_messages is
  'RLS-protected real-time messages for customer support conversations.';
