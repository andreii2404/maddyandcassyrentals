-- File attachments for support chat (customers, guests and admins).
--
-- Files live in the private chat-attachments bucket at
--   <conversation id>/<uploader id>/<random id>.<extension>
-- and only the conversation's customer and admins can read them, matching the
-- access rules of the chat messages themselves. A chat message stores the
-- object path plus the file name, MIME type and size; the file itself never
-- goes through the database.
--
-- Type and size are enforced three times: by the composer
-- (src/lib/chatAttachments.ts), by the bucket's allowed_mime_types and
-- file_size_limit, and by send_chat_attachment_message, which re-reads the
-- stored object before linking it. Keep the lists identical in all places.
--
-- send_chat_message is unchanged; text-only messages keep using it.
-- send_chat_attachment_message repeats its rules (rate limit, closed chats,
-- profanity on the text, consecutive-message allowance) so a message with an
-- attachment counts as exactly one message.

-- 1. Bucket ---------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2. Message columns ------------------------------------------------------------------------
alter table public.chat_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime_type text,
  add column if not exists attachment_size_bytes integer;

-- A message with an attachment may have no text. Text-only messages keep the
-- original 1-2000 character rule.
alter table public.chat_messages drop constraint if exists chat_messages_body_check;
alter table public.chat_messages add constraint chat_messages_body_check check (
  (attachment_path is null and length(trim(body)) between 1 and 2000)
  or (attachment_path is not null and length(trim(body)) <= 2000)
);

alter table public.chat_messages drop constraint if exists chat_messages_attachment_check;
alter table public.chat_messages add constraint chat_messages_attachment_check check (
  (
    attachment_path is null
    and attachment_name is null
    and attachment_mime_type is null
    and attachment_size_bytes is null
  )
  or (
    attachment_path is not null
    and attachment_name is not null
    and length(attachment_name) between 1 and 255
    and attachment_mime_type in (
      'image/jpeg',
      'image/png',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    and attachment_size_bytes between 1 and 10485760
  )
);

-- One stored file belongs to exactly one message.
create unique index if not exists chat_messages_attachment_path_key
  on public.chat_messages (attachment_path)
  where attachment_path is not null;

-- 3. Storage access helpers -----------------------------------------------------------------
-- Canonical MIME type for an accepted extension (null when not accepted).
create or replace function private.chat_attachment_mime_type(p_extension text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(p_extension, ''))
    when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'png' then 'image/png'
    when 'pdf' then 'application/pdf'
    when 'doc' then 'application/msword'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    else null
  end;
$$;

-- Conversation id from an object path, or null when the path is malformed.
create or replace function private.chat_attachment_conversation_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_name, '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf|doc|docx)$'
    then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

-- Uploads go into the caller's own folder of an open conversation they can
-- access. Customers who must wait for a reply cannot upload either.
create or replace function private.can_upload_chat_attachment(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_conversation_id uuid := private.chat_attachment_conversation_id(p_name);
  v_status text;
begin
  if v_uid is null or v_conversation_id is null then
    return false;
  end if;
  if split_part(p_name, '/', 2) <> v_uid::text then
    return false;
  end if;
  if not private.can_access_chat_conversation(v_conversation_id, v_uid) then
    return false;
  end if;

  select conversation.status
  into v_status
  from public.chat_conversations as conversation
  where conversation.id = v_conversation_id;

  if v_status is distinct from 'open' then
    return false;
  end if;

  if not (select private.is_admin())
    and private.count_pending_customer_messages(v_conversation_id)
      >= private.chat_customer_message_limit()
  then
    return false;
  end if;

  return true;
end;
$$;

-- Readable by the conversation's customer and admins only.
create or replace function private.can_read_chat_attachment(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_conversation_id uuid := private.chat_attachment_conversation_id(p_name);
begin
  if v_uid is null or v_conversation_id is null then
    return false;
  end if;
  return private.can_access_chat_conversation(v_conversation_id, v_uid);
end;
$$;

-- An uploader may remove their own file only while no message uses it, so a
-- failed send can clean up after itself. Sent attachments cannot be deleted.
create or replace function private.can_delete_chat_attachment(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or private.chat_attachment_conversation_id(p_name) is null then
    return false;
  end if;
  if split_part(p_name, '/', 2) <> v_uid::text then
    return false;
  end if;
  return not exists (
    select 1
    from public.chat_messages as message
    where message.attachment_path = p_name
  );
end;
$$;

revoke all on function private.chat_attachment_mime_type(text) from public, anon, authenticated;
revoke all on function private.chat_attachment_conversation_id(text) from public, anon, authenticated;
revoke all on function private.can_upload_chat_attachment(text) from public, anon;
revoke all on function private.can_read_chat_attachment(text) from public, anon;
revoke all on function private.can_delete_chat_attachment(text) from public, anon;

grant usage on schema private to authenticated;
grant execute on function private.can_upload_chat_attachment(text) to authenticated;
grant execute on function private.can_read_chat_attachment(text) to authenticated;
grant execute on function private.can_delete_chat_attachment(text) to authenticated;

-- 4. Storage policies -----------------------------------------------------------------------
drop policy if exists chat_attachments_participant_insert on storage.objects;
create policy chat_attachments_participant_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-attachments'
  and private.can_upload_chat_attachment(name)
);

drop policy if exists chat_attachments_participant_read on storage.objects;
create policy chat_attachments_participant_read
on storage.objects for select to authenticated
using (
  bucket_id = 'chat-attachments'
  and private.can_read_chat_attachment(name)
);

drop policy if exists chat_attachments_uploader_delete_unsent on storage.objects;
create policy chat_attachments_uploader_delete_unsent
on storage.objects for delete to authenticated
using (
  bucket_id = 'chat-attachments'
  and private.can_delete_chat_attachment(name)
);

-- 5. Message history now includes attachment details ----------------------------------------
-- The return type gains columns, so the old signature must be dropped first.
drop function if exists public.list_chat_messages(uuid, integer);

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
  edited_at timestamptz,
  attachment_path text,
  attachment_name text,
  attachment_mime_type text,
  attachment_size_bytes integer
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
    message.edited_at,
    message.attachment_path,
    message.attachment_name,
    message.attachment_mime_type,
    message.attachment_size_bytes
  from public.chat_messages as message
  left join public.profiles as profile on profile.id = message.sender_id
  where message.conversation_id = p_conversation_id
  order by message.created_at asc, message.id asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

revoke all on function public.list_chat_messages(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_chat_messages(uuid, integer) to authenticated;
grant execute on function public.list_chat_messages(uuid, integer) to service_role;

-- 6. Sending a message with an attachment ---------------------------------------------------
-- Same rules as send_chat_message (20261001160000_chat_profanity_filter.sql),
-- plus validation of the uploaded object. The text may be empty when a file is
-- attached.
create or replace function public.send_chat_attachment_message(
  p_conversation_id uuid,
  p_body text,
  p_client_message_id uuid,
  p_attachment_path text,
  p_attachment_name text
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
  edited_at timestamptz,
  attachment_path text,
  attachment_name text,
  attachment_mime_type text,
  attachment_size_bytes integer
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
  v_path text := coalesce(p_attachment_path, '');
  v_path_extension text;
  v_expected_mime text;
  v_name text;
  v_object_metadata jsonb;
  v_object_mime text;
  v_object_size bigint;
  v_message public.chat_messages;
  v_conversation public.chat_conversations;
  v_sender_name text;
  v_existing_message_id uuid;
  v_preview text;
begin
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '28000';
  end if;
  if length(v_body) > 2000 then
    raise exception 'INVALID_MESSAGE';
  end if;
  if p_client_message_id is null then
    raise exception 'MESSAGE_ID_REQUIRED';
  end if;

  -- The path must point into this conversation and the caller's own folder.
  if private.chat_attachment_conversation_id(v_path) is distinct from p_conversation_id
    or split_part(v_path, '/', 2) <> v_uid::text
  then
    raise exception 'CHAT_ATTACHMENT_INVALID';
  end if;

  v_path_extension := lower(substring(v_path from '\.([a-z]+)$'));
  v_expected_mime := private.chat_attachment_mime_type(v_path_extension);
  if v_expected_mime is null then
    raise exception 'CHAT_ATTACHMENT_INVALID';
  end if;

  -- Display name: no control characters or path separators, max 255 characters,
  -- and the same extension as the stored object.
  v_name := left(trim(regexp_replace(coalesce(p_attachment_name, ''), '[[:cntrl:]/\\]', '', 'g')), 255);
  if v_name = '' then
    v_name := 'attachment.' || v_path_extension;
  end if;
  if lower(substring(v_name from '\.([A-Za-z]+)$')) is distinct from v_path_extension then
    raise exception 'CHAT_ATTACHMENT_INVALID';
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

  -- Same text screening as send_chat_message; admin replies are not screened.
  if not v_is_admin and v_body <> '' and private.chat_message_has_profanity(v_body) then
    raise exception 'CHAT_INAPPROPRIATE_LANGUAGE';
  end if;

  select stored_message.id
  into v_existing_message_id
  from public.chat_messages as stored_message
  where stored_message.conversation_id = p_conversation_id
    and stored_message.client_message_id = p_client_message_id;

  -- A file can only ever be attached to one message (a retry of the same send
  -- returns the stored message instead).
  if v_existing_message_id is null and exists (
    select 1
    from public.chat_messages as linked_message
    where linked_message.attachment_path = v_path
  ) then
    raise exception 'CHAT_ATTACHMENT_INVALID';
  end if;

  -- An attachment message counts as one message toward the allowance.
  if not v_is_admin
    and v_existing_message_id is null
    and private.count_pending_customer_messages(p_conversation_id)
      >= private.chat_customer_message_limit()
  then
    raise exception 'CHAT_REPLY_REQUIRED';
  end if;

  -- Re-check the uploaded object itself: it must exist, and its stored type
  -- and size must match the accepted list.
  select stored_object.metadata
  into v_object_metadata
  from storage.objects as stored_object
  where stored_object.bucket_id = 'chat-attachments'
    and stored_object.name = v_path;

  if v_object_metadata is null then
    raise exception 'CHAT_ATTACHMENT_NOT_FOUND';
  end if;

  v_object_mime := lower(trim(split_part(coalesce(v_object_metadata->>'mimetype', ''), ';', 1)));
  v_object_size := case
    when coalesce(v_object_metadata->>'size', '') ~ '^[0-9]{1,12}$'
      then (v_object_metadata->>'size')::bigint
    else null
  end;

  if v_object_mime <> v_expected_mime then
    raise exception 'CHAT_ATTACHMENT_INVALID';
  end if;
  if v_object_size is null or v_object_size < 1 or v_object_size > 10485760 then
    raise exception 'CHAT_ATTACHMENT_TOO_LARGE';
  end if;

  insert into public.chat_messages as inserted_message (
    conversation_id,
    sender_id,
    sender_role,
    message_type,
    body,
    client_message_id,
    attachment_path,
    attachment_name,
    attachment_mime_type,
    attachment_size_bytes
  ) values (
    p_conversation_id,
    v_uid,
    v_role,
    'text',
    v_body,
    p_client_message_id,
    v_path,
    v_name,
    v_expected_mime,
    v_object_size::integer
  )
  on conflict on constraint chat_messages_client_key do update
    set client_message_id = excluded.client_message_id
  returning inserted_message.* into v_message;

  v_preview := case
    when v_message.body <> '' then v_message.body
    when v_message.attachment_name is not null then 'Attachment: ' || v_message.attachment_name
    else 'Attachment'
  end;

  update public.chat_conversations
  set
    last_message_preview = left(v_preview, 180),
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
    v_message.edited_at,
    v_message.attachment_path,
    v_message.attachment_name,
    v_message.attachment_mime_type,
    v_message.attachment_size_bytes;
end;
$$;

revoke all on function public.send_chat_attachment_message(uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.send_chat_attachment_message(uuid, text, uuid, text, text)
  to authenticated;
grant execute on function public.send_chat_attachment_message(uuid, text, uuid, text, text)
  to service_role;

comment on column public.chat_messages.attachment_path is
  'Object path in the private chat-attachments bucket: <conversation id>/<uploader id>/<random id>.<extension>.';
comment on function public.send_chat_attachment_message(uuid, text, uuid, text, text) is
  'Sends a chat message with one uploaded attachment and optional text. Counts as one message toward the customer allowance.';
