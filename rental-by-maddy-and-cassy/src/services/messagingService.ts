import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/lib/supabase/database.types";
import {
  CHAT_ATTACHMENT_BUCKET,
  CHAT_ATTACHMENT_SIZE_ERROR,
  CHAT_ATTACHMENT_TYPE_ERROR,
  buildChatAttachmentPath,
  chatAttachmentDisplayName,
  validateChatAttachment,
} from "@/src/lib/chatAttachments";

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
  /** Consecutive customer messages in this conversation since the latest support reply. */
  pendingCustomerMessages: number;
  /** Consecutive customer messages allowed before support has to reply. */
  customerMessageLimit: number;
  createdAt: string;
}

/** Mirrors private.chat_customer_message_limit() for pre-migration databases. */
export const DEFAULT_CUSTOMER_MESSAGE_LIMIT = 2;

export const REPLY_REQUIRED_MESSAGE =
  "Please wait for our reply before sending another message.";

/** Shown when a customer message is blocked by the profanity filter. */
export const INAPPROPRIATE_LANGUAGE_MESSAGE =
  "Please remove inappropriate or offensive language before sending your message.";

/** Shown when a message references an upload that is missing from storage. */
export const ATTACHMENT_NOT_UPLOADED_MESSAGE =
  "The attachment didn't finish uploading. Please attach the file again.";

export interface ChatAttachment {
  /** Object path in the private chat-attachments bucket. */
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
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
  attachment: ChatAttachment | null;
}

type Client = SupabaseClient<Database>;

/** Rows from databases without the attachment migration simply lack these columns. */
type MessageRow = Omit<
  Database["public"]["Functions"]["list_chat_messages"]["Returns"][number],
  "attachment_path" | "attachment_name" | "attachment_mime_type" | "attachment_size_bytes"
> & Partial<Pick<
  Database["public"]["Functions"]["list_chat_messages"]["Returns"][number],
  "attachment_path" | "attachment_name" | "attachment_mime_type" | "attachment_size_bytes"
>>;

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
    pendingCustomerMessages: Number(row.pending_customer_messages ?? 0),
    customerMessageLimit: Number(row.customer_message_limit ?? DEFAULT_CUSTOMER_MESSAGE_LIMIT)
      || DEFAULT_CUSTOMER_MESSAGE_LIMIT,
    createdAt: row.created_at,
  };
}

function attachmentFromRow(row: MessageRow): ChatAttachment | null {
  if (!row.attachment_path || !row.attachment_name || !row.attachment_mime_type) return null;
  return {
    path: row.attachment_path,
    name: row.attachment_name,
    mimeType: row.attachment_mime_type,
    sizeBytes: Number(row.attachment_size_bytes ?? 0),
  };
}

function messageFromRow(row: MessageRow): ChatMessage {
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
    attachment: attachmentFromRow(row),
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
    return new Error(CHAT_SESSION_EXPIRED_MESSAGE);
  }
  if (normalized.includes("chat_reply_required")) {
    return new Error(REPLY_REQUIRED_MESSAGE);
  }
  if (normalized.includes("chat_inappropriate_language")) {
    return new Error(INAPPROPRIATE_LANGUAGE_MESSAGE);
  }
  if (normalized.includes("chat_rate_limit")) {
    return new Error("You are sending messages too quickly. Please wait a moment and try again.");
  }
  if (normalized.includes("chat_attachment_too_large")) {
    return new Error(CHAT_ATTACHMENT_SIZE_ERROR);
  }
  if (normalized.includes("chat_attachment_not_found")) {
    return new Error(ATTACHMENT_NOT_UPLOADED_MESSAGE);
  }
  if (normalized.includes("chat_attachment_invalid")) {
    return new Error(CHAT_ATTACHMENT_TYPE_ERROR);
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
  attachment: Pick<ChatAttachment, "path" | "name"> | null = null,
): Promise<ChatMessage> {
  // Text-only messages keep using send_chat_message unchanged. A message with a
  // file goes through send_chat_attachment_message, which applies the same
  // rules and counts it as one message.
  if (attachment) {
    const { data, error } = await client.rpc("send_chat_attachment_message", {
      p_conversation_id: conversationId,
      p_body: body,
      p_client_message_id: clientMessageId,
      p_attachment_path: attachment.path,
      p_attachment_name: attachment.name,
    });
    if (error || !data?.[0]) throw messagingError(error?.message ?? "Message could not be sent.");
    return messageFromRow(data[0]);
  }

  const { data, error } = await client.rpc("send_chat_message", {
    p_conversation_id: conversationId,
    p_body: body,
    p_client_message_id: clientMessageId,
  });
  if (error || !data?.[0]) throw messagingError(error?.message ?? "Message could not be sent.");
  return messageFromRow(data[0]);
}

export class ChatAttachmentUploadError extends Error {}

export interface UploadChatAttachmentOptions {
  /** Called with 0-100 as the file uploads. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export const CHAT_SESSION_EXPIRED_MESSAGE = "Your chat session expired. Refresh the page to continue.";
export const ATTACHMENT_ACCESS_DENIED_MESSAGE =
  "You can't attach files to this conversation right now. Refresh the page and try again.";
/** The chat-attachments bucket is missing (attachment migration not applied). */
export const ATTACHMENTS_UNAVAILABLE_MESSAGE =
  "File attachments aren't available right now. Please try again later or send your message without a file.";
export const ATTACHMENT_UPLOAD_FAILED_MESSAGE =
  "The file could not be uploaded. Check your connection and try again.";

/**
 * Maps a failed Storage upload to a customer-facing message. Storage often
 * answers 400 with the real status in the JSON body's `statusCode`, so both
 * are checked.
 */
export function chatAttachmentUploadErrorMessage(status: number, responseText: string): string {
  let code = "";
  let detail = "";
  try {
    const parsed = JSON.parse(responseText) as { message?: unknown; error?: unknown; statusCode?: unknown };
    code = String(parsed.statusCode ?? "");
    detail = `${String(parsed.message ?? "")} ${String(parsed.error ?? "")}`;
  } catch {
    detail = responseText;
  }
  const normalized = detail.toLowerCase();
  if (status === 413 || code === "413" || normalized.includes("too large") || normalized.includes("maximum allowed size")) {
    return CHAT_ATTACHMENT_SIZE_ERROR;
  }
  if (status === 415 || code === "415" || normalized.includes("mime")) {
    return CHAT_ATTACHMENT_TYPE_ERROR;
  }
  if (status === 401 || normalized.includes("jwt") || normalized.includes("claim")) {
    return CHAT_SESSION_EXPIRED_MESSAGE;
  }
  if (status === 403 || code === "403" || normalized.includes("row-level security") || normalized.includes("unauthorized")) {
    return ATTACHMENT_ACCESS_DENIED_MESSAGE;
  }
  if (status === 404 || code === "404" || normalized.includes("bucket not found")) {
    return ATTACHMENTS_UNAVAILABLE_MESSAGE;
  }
  return ATTACHMENT_UPLOAD_FAILED_MESSAGE;
}

/**
 * Uploads a file straight to the private chat-attachments bucket (the bucket
 * and its storage policies re-check type, size and conversation access). The
 * upload goes directly to Supabase Storage so 10 MB files never pass through
 * a server function, and uses XHR so the composer can show progress.
 */
export async function uploadChatAttachment(
  client: Client,
  conversationId: string,
  file: File,
  { onProgress, signal }: UploadChatAttachmentOptions = {},
): Promise<ChatAttachment> {
  const validation = validateChatAttachment(file);
  if (!validation.ok) throw new ChatAttachmentUploadError(validation.error);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new ChatAttachmentUploadError("File uploads are not available right now. Please try again later.");
  }

  const { data: sessionData } = await client.auth.getSession();
  const session = sessionData.session;
  if (!session?.access_token || !session.user?.id) {
    throw new ChatAttachmentUploadError(CHAT_SESSION_EXPIRED_MESSAGE);
  }

  const path = buildChatAttachmentPath(conversationId, session.user.id, validation.extension);
  const endpoint = `${url.replace(/\/+$/, "")}/storage/v1/object/${CHAT_ATTACHMENT_BUCKET}/${path}`;

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();

    request.open("POST", endpoint);
    request.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    request.setRequestHeader("apikey", publishableKey);
    request.setRequestHeader("Content-Type", validation.mimeType);
    request.setRequestHeader("Cache-Control", "max-age=3600");
    request.setRequestHeader("x-upsert", "false");

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    request.onload = () => {
      signal?.removeEventListener("abort", abort);
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        if (process.env.NODE_ENV !== "production") {
          console.error(
            `[uploadChatAttachment] storage rejected upload status=${request.status} path=${path}`,
            request.responseText,
          );
        }
        reject(new ChatAttachmentUploadError(
          chatAttachmentUploadErrorMessage(request.status, request.responseText),
        ));
      }
    };
    request.onerror = () => {
      signal?.removeEventListener("abort", abort);
      if (process.env.NODE_ENV !== "production") {
        console.error(`[uploadChatAttachment] network error uploading path=${path}`);
      }
      reject(new ChatAttachmentUploadError(ATTACHMENT_UPLOAD_FAILED_MESSAGE));
    };
    request.onabort = () => {
      signal?.removeEventListener("abort", abort);
      reject(new ChatAttachmentUploadError("The upload was cancelled."));
    };

    if (signal?.aborted) {
      reject(new ChatAttachmentUploadError("The upload was cancelled."));
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    onProgress?.(0);
    request.send(file);
  });

  return {
    path,
    name: chatAttachmentDisplayName(file.name, validation.extension),
    mimeType: validation.mimeType,
    sizeBytes: file.size,
  };
}

/** Best-effort removal of an uploaded file that never made it into a message. */
export async function removeChatAttachment(client: Client, path: string): Promise<void> {
  try {
    await client.storage.from(CHAT_ATTACHMENT_BUCKET).remove([path]);
  } catch {
    // Storage policies only allow removing unsent uploads; nothing else to do.
  }
}

/** Short-lived signed URLs for attachments the caller is allowed to read. */
export async function createAttachmentUrls(
  client: Client,
  paths: string[],
  expiresInSeconds = 60 * 60,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  const { data, error } = await client.storage
    .from(CHAT_ATTACHMENT_BUCKET)
    .createSignedUrls(paths, expiresInSeconds);
  if (error || !data) return urls;
  for (const entry of data) {
    if (entry.path && entry.signedUrl && !entry.error) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
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
