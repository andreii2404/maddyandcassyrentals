import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/lib/supabase/database.types";

export interface ChatConversation {
  id: string;
  bookingId: string | null;
  bookingReference: string | null;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  isGuest: boolean;
  subject: string;
  status: "open" | "closed";
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string | null;
  senderRole: "customer" | "admin" | "system";
  senderName: string;
  messageType: "text" | "system";
  body: string;
  createdAt: string;
  editedAt: string | null;
}

type Client = SupabaseClient<Database>;

function conversationFromRow(
  row: Database["public"]["Functions"]["list_chat_conversations"]["Returns"][number],
): ChatConversation {
  return {
    id: row.id,
    bookingId: row.booking_id,
    bookingReference: row.booking_reference,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    isGuest: row.is_guest,
    subject: row.subject,
    status: row.status === "closed" ? "closed" : "open",
    lastMessagePreview: row.last_message_preview,
    lastMessageAt: row.last_message_at,
    unreadCount: Number(row.unread_count ?? 0),
    createdAt: row.created_at,
  };
}

function messageFromRow(
  row: Database["public"]["Functions"]["list_chat_messages"]["Returns"][number],
): ChatMessage {
  const senderRole = row.sender_role === "admin"
    ? "admin"
    : row.sender_role === "system"
      ? "system"
      : "customer";
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderRole,
    senderName: row.sender_name,
    messageType: row.message_type === "system" ? "system" : "text",
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

function messagingError(message: string): Error {
  const normalized = message.toLowerCase();
  if (normalized.includes("chat_closed")) {
    return new Error("This conversation has been closed. Start a new chat if you still need help.");
  }
  if (normalized.includes("chat_access_denied") || normalized.includes("permission denied")) {
    return new Error("You no longer have access to this conversation.");
  }
  if (normalized.includes("authentication_required") || normalized.includes("jwt")) {
    return new Error("Your chat session expired. Refresh the page to continue.");
  }
  if (normalized.includes("chat_rate_limit")) {
    return new Error("You are sending messages too quickly. Please wait a moment and try again.");
  }
  return new Error("Messages could not be updated. Please try again.");
}

export async function getOrCreateConversation(
  client: Client,
  bookingId: string | null = null,
): Promise<string> {
  const { data, error } = await client.rpc("get_or_create_chat_conversation", {
    p_booking_id: bookingId,
  });
  if (error || !data) throw messagingError(error?.message ?? "Conversation could not be created.");
  return data;
}

export async function listConversations(client: Client): Promise<ChatConversation[]> {
  const { data, error } = await client.rpc("list_chat_conversations");
  if (error) throw messagingError(error.message);
  return (data ?? []).map(conversationFromRow);
}

export async function listMessages(
  client: Client,
  conversationId: string,
): Promise<ChatMessage[]> {
  const { data, error } = await client.rpc("list_chat_messages", {
    p_conversation_id: conversationId,
    p_limit: 300,
  });
  if (error) throw messagingError(error.message);
  return (data ?? []).map(messageFromRow);
}

export async function sendMessage(
  client: Client,
  conversationId: string,
  body: string,
  clientMessageId = crypto.randomUUID(),
): Promise<ChatMessage> {
  const { data, error } = await client.rpc("send_chat_message", {
    p_conversation_id: conversationId,
    p_body: body,
    p_client_message_id: clientMessageId,
  });
  if (error || !data?.[0]) throw messagingError(error?.message ?? "Message could not be sent.");
  return messageFromRow(data[0]);
}

export async function markConversationRead(
  client: Client,
  conversationId: string,
): Promise<void> {
  const { error } = await client.rpc("mark_chat_conversation_read", {
    p_conversation_id: conversationId,
  });
  if (error) throw messagingError(error.message);
}
