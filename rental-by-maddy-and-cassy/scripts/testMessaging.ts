import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import {
  getOrCreateConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
} from "../src/services/messagingService";

type RpcResult = { data: unknown; error: { message: string } | null };

function clientWithResults(results: RpcResult[]) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = {
    rpc: async (name: string, args?: unknown) => {
      calls.push({ name, args });
      return results.shift() ?? { data: null, error: { message: "Missing fake result" } };
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

test("conversation rows are mapped into UI-safe camel-case records", async () => {
  const { client } = clientWithResults([{ data: [{
    id: "conversation-1",
    booking_id: null,
    booking_reference: null,
    customer_id: "customer-1",
    customer_name: "Guest customer",
    customer_email: null,
    is_guest: true,
    subject: "Rental support",
    status: "open",
    last_message_preview: "Hello",
    last_message_at: "2026-09-26T01:00:00.000Z",
    unread_count: 2,
    created_at: "2026-09-26T00:00:00.000Z",
  }], error: null }]);

  const conversations = await listConversations(client);
  assert.equal(conversations[0].customerName, "Guest customer");
  assert.equal(conversations[0].isGuest, true);
  assert.equal(conversations[0].unreadCount, 2);
});

test("guest and registered callers use the same secure conversation RPC", async () => {
  const { client, calls } = clientWithResults([{ data: "conversation-2", error: null }]);
  assert.equal(await getOrCreateConversation(client), "conversation-2");
  assert.deepEqual(calls[0], {
    name: "get_or_create_chat_conversation",
    args: { p_booking_id: null },
  });
});

test("message sending uses an idempotency key and preserves the returned sender role", async () => {
  const { client, calls } = clientWithResults([{ data: [{
    id: "message-1",
    conversation_id: "conversation-1",
    sender_id: "admin-1",
    sender_role: "admin",
    sender_name: "Maddy & Cassy Support",
    message_type: "text",
    body: "Your unit is ready for pickup.",
    created_at: "2026-09-26T02:00:00.000Z",
    edited_at: null,
  }], error: null }]);

  const message = await sendMessage(
    client,
    "conversation-1",
    "Your unit is ready for pickup.",
    "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(message.senderRole, "admin");
  assert.deepEqual(calls[0], {
    name: "send_chat_message",
    args: {
      p_conversation_id: "conversation-1",
      p_body: "Your unit is ready for pickup.",
      p_client_message_id: "11111111-1111-4111-8111-111111111111",
    },
  });
});

test("message history and read state use access-controlled RPCs", async () => {
  const { client, calls } = clientWithResults([
    { data: [], error: null },
    { data: null, error: null },
  ]);
  assert.deepEqual(await listMessages(client, "conversation-1"), []);
  await markConversationRead(client, "conversation-1");
  assert.equal(calls[0].name, "list_chat_messages");
  assert.equal(calls[1].name, "mark_chat_conversation_read");
});

test("database errors are converted into plain customer-facing messages", async () => {
  const { client } = clientWithResults([{
    data: null,
    error: { message: "CHAT_RATE_LIMIT" },
  }]);
  await assert.rejects(
    () => listConversations(client),
    /sending messages too quickly/i,
  );
});
