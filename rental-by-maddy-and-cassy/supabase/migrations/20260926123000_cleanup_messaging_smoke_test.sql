-- Remove the empty guest thread created while smoke-testing the production
-- messaging schema. The guard preserves it if any participant has replied.
delete from public.chat_conversations as conversation
where conversation.id = 'c4efd03c-7045-4220-bdf9-45484b84f21c'::uuid
  and conversation.booking_id is null
  and not exists (
    select 1
    from public.chat_messages as message
    where message.conversation_id = conversation.id
      and message.sender_role <> 'system'
  );
