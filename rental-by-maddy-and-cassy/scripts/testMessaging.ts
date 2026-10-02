import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import {
  HOMOGLYPH_FROM,
  HOMOGLYPH_TO,
  LEET_FROM,
  LEET_TO,
  PROFANITY_TERMS,
  containsProfanity,
} from "../src/lib/chatProfanity";
import {
  CHAT_ATTACHMENT_EMPTY_ERROR,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_SIZE_ERROR,
  CHAT_ATTACHMENT_TYPES,
  CHAT_ATTACHMENT_TYPE_ERROR,
  attachmentTypeLabel,
  buildChatAttachmentPath,
  chatAttachmentDisplayName,
  formatFileSize,
  validateChatAttachment,
} from "../src/lib/chatAttachments";
import {
  ATTACHMENT_ACCESS_DENIED_MESSAGE,
  ATTACHMENT_NOT_UPLOADED_MESSAGE,
  ATTACHMENT_UPLOAD_FAILED_MESSAGE,
  ATTACHMENTS_UNAVAILABLE_MESSAGE,
  CHAT_SESSION_EXPIRED_MESSAGE,
  DEFAULT_CUSTOMER_MESSAGE_LIMIT,
  chatAttachmentUploadErrorMessage,
  INAPPROPRIATE_LANGUAGE_MESSAGE,
  REPLY_REQUIRED_MESSAGE,
  getOrCreateConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
} from "../src/services/messagingService";

const chatSendMigration = readFileSync(
  new URL("../supabase/migrations/20260926075045_fix_chat_message_send.sql", import.meta.url),
  "utf8",
);

const consecutiveLimitMigration = readFileSync(
  new URL(
    "../supabase/migrations/20261001120000_limit_consecutive_customer_messages.sql",
    import.meta.url,
  ),
  "utf8",
);

const profanityMigration = readFileSync(
  new URL("../supabase/migrations/20261001160000_chat_profanity_filter.sql", import.meta.url),
  "utf8",
);

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
    pending_customer_messages: 1,
    customer_message_limit: 2,
    created_at: "2026-09-26T00:00:00.000Z",
  }], error: null }]);

  const conversations = await listConversations(client);
  assert.equal(conversations[0].customerName, "Guest customer");
  assert.equal(conversations[0].isGuest, true);
  assert.equal(conversations[0].unreadCount, 2);
  assert.equal(conversations[0].pendingCustomerMessages, 1);
  assert.equal(conversations[0].customerMessageLimit, 2);
});

test("conversations from a database without the limit columns fall back to the default", async () => {
  const { client } = clientWithResults([{ data: [{
    id: "conversation-legacy",
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
    unread_count: 0,
    created_at: "2026-09-26T00:00:00.000Z",
  }], error: null }]);

  const conversations = await listConversations(client);
  assert.equal(conversations[0].pendingCustomerMessages, 0);
  assert.equal(conversations[0].customerMessageLimit, DEFAULT_CUSTOMER_MESSAGE_LIMIT);
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

test("chat send SQL uses an unambiguous idempotency constraint", () => {
  assert.match(
    chatSendMigration,
    /on conflict on constraint chat_messages_client_key do update/i,
  );
  assert.doesNotMatch(
    chatSendMigration,
    /on conflict\s*\(\s*conversation_id\s*,\s*client_message_id\s*\)/i,
  );
});

test("chat send SQL returns a sender even when a guest profile is absent", () => {
  assert.match(
    chatSendMigration,
    /left join public\.profiles as profile on profile\.id = v_uid/i,
  );
  assert.match(chatSendMigration, /'Guest customer'/i);
});

test("reaching the consecutive message limit surfaces the wait-for-reply notice", async () => {
  const { client } = clientWithResults([{
    data: null,
    error: { message: "CHAT_REPLY_REQUIRED" },
  }]);
  await assert.rejects(
    () => sendMessage(client, "conversation-1", "Any update?", "22222222-2222-4222-8222-222222222222"),
    (sendError: Error) => {
      assert.equal(sendError.message, REPLY_REQUIRED_MESSAGE);
      return true;
    },
  );
});

test("the consecutive message limit is enforced inside the send RPC", () => {
  assert.match(consecutiveLimitMigration, /raise exception 'CHAT_REPLY_REQUIRED'/i);
  assert.match(
    consecutiveLimitMigration,
    /not v_is_admin[\s\S]{0,200}private\.count_pending_customer_messages\(p_conversation_id\)\s*>=\s*private\.chat_customer_message_limit\(\)/i,
  );
  assert.match(consecutiveLimitMigration, /select 2;/);
});

test("pending customer messages are counted per conversation after the latest admin reply", () => {
  assert.match(
    consecutiveLimitMigration,
    /customer_message\.conversation_id = p_conversation_id/i,
  );
  assert.match(
    consecutiveLimitMigration,
    /select max\(admin_message\.created_at\)[\s\S]{0,200}admin_message\.sender_role = 'admin'/i,
  );
  assert.match(
    consecutiveLimitMigration,
    /private\.count_pending_customer_messages\(conversation\.id\) as pending_customer_messages/i,
  );
});

test("the limit never blocks admins, retried sends, or conversation creation", () => {
  // Admin replies must keep working, so the guard is gated on `not v_is_admin`.
  assert.match(consecutiveLimitMigration, /not v_is_admin\s*\n\s*and v_existing_message_id is null/i);
  // An already stored client_message_id is a retry, not a new message.
  assert.match(
    consecutiveLimitMigration,
    /stored_message\.client_message_id = p_client_message_id/i,
  );
  // get_or_create_chat_conversation is untouched, so no duplicate threads appear.
  assert.doesNotMatch(consecutiveLimitMigration, /get_or_create_chat_conversation/i);
});

test("profane English and Tagalog messages are detected, including common bypasses", () => {
  const blocked = [
    "fuck",
    "FuCk you",
    "fuuuuuck",
    "f.u.c.k",
    "f u c k",
    "f**k this",
    "f*ck",
    "fucking**",
    "motherfucker",
    "sh!t",
    "5h1t",
    "$hit!",
    "b1tch",
    "BITCHES",
    "asshole",
    "a s s h o l e",
    "fuсk", // Cyrillic "с" standing in for "c"
    "fúck",
    "putangina mo",
    "Putang ina mo",
    "tang ina",
    "tang-ina",
    "tanginamo",
    "gago ka",
    "gaaagooo",
    "g a g o",
    "#gago",
    "hi,gago",
    "ulol",
    "bobo mo",
    "t4ng4",
    "hayop ka",
    "pakyu",
    "pak shet",
    "taena",
    "kantutan",
  ];
  for (const message of blocked) {
    assert.equal(containsProfanity(message), true, `expected "${message}" to be blocked`);
  }
});

test("ordinary words that resemble profanity are not blocked", () => {
  const allowed = [
    "Hello! Is the iPhone 15 available tomorrow?",
    "Can I pay at 3pm? ₱500 po",
    "class, pass, assistant, assessment",
    "Scunthorpe cocktail Dickens shiitake",
    "Fukuoka trip next week",
    "Masarap ang putahe",
    "Niger and Nigeria",
    "hawak ko, tangan ko",
    "gagawin ko bukas",
    "masakit ang ulo ko",
    "salsa",
    "bilang ng araw",
    "hindi pa po",
    "iyong camera",
    "tainga, tenga",
    "bubong",
    "Tita ko po",
    "tanghali, tangke",
    "5*3=15",
    "**important**",
    "Lady Gaga concert",
    "flame retardant",
    "thank you po, sige po",
  ];
  for (const message of allowed) {
    assert.equal(containsProfanity(message), false, `expected "${message}" to be allowed`);
  }
});

test("the server-side profanity rejection surfaces the inline notice", async () => {
  const { client } = clientWithResults([{
    data: null,
    error: { message: "CHAT_INAPPROPRIATE_LANGUAGE" },
  }]);
  await assert.rejects(
    () => sendMessage(client, "conversation-1", "anything", "33333333-3333-4333-8333-333333333333"),
    (sendError: Error) => {
      assert.equal(sendError.message, INAPPROPRIATE_LANGUAGE_MESSAGE);
      assert.equal(
        INAPPROPRIATE_LANGUAGE_MESSAGE,
        "Please remove inappropriate or offensive language before sending your message.",
      );
      return true;
    },
  );
});

test("the SQL profanity filter uses the same terms and character maps as the client", () => {
  for (const entry of PROFANITY_TERMS) {
    const suffixes = entry.suffixes.map((suffix) => `'${suffix}'`).join(", ");
    const row = `('${entry.kind}', '${entry.term}', array[${suffixes}])`;
    assert.ok(profanityMigration.includes(row), `migration is missing ${row}`);
  }
  const sqlRows = profanityMigration.match(/^\s*\('(?:contains|word|phrase)', '/gm) ?? [];
  assert.equal(sqlRows.length, PROFANITY_TERMS.length);
  assert.ok(profanityMigration.includes(`translate(v_text, '${HOMOGLYPH_FROM}', '${HOMOGLYPH_TO}')`));
  assert.ok(profanityMigration.includes(`translate(v_word, '${LEET_FROM}', '${LEET_TO}')`));
});

test("send_chat_message rejects profane customer messages before storing them", () => {
  assert.match(
    profanityMigration,
    /if not v_is_admin and private\.chat_message_has_profanity\(v_body\) then\s*\n\s*raise exception 'CHAT_INAPPROPRIATE_LANGUAGE'/i,
  );
  const checkIndex = profanityMigration.indexOf("private.chat_message_has_profanity(v_body)");
  const insertIndex = profanityMigration.indexOf("insert into public.chat_messages");
  assert.ok(checkIndex > 0 && checkIndex < insertIndex);
  // The consecutive-message limit is carried over unchanged.
  assert.match(
    profanityMigration,
    /not v_is_admin\s*\n\s*and v_existing_message_id is null\s*\n\s*and private\.count_pending_customer_messages\(p_conversation_id\)\s*\n?\s*>=\s*private\.chat_customer_message_limit\(\)/i,
  );
  // Historical messages are never rewritten.
  assert.doesNotMatch(profanityMigration, /update public\.chat_messages/i);
});

const attachmentMigration = readFileSync(
  new URL("../supabase/migrations/20261001200000_chat_message_attachments.sql", import.meta.url),
  "utf8",
);

test("chat attachments accept JPG, JPEG, PNG, PDF, DOC and DOCX up to 10 MB", () => {
  const accepted: Array<[string, string, string]> = [
    ["photo.jpg", "image/jpeg", "image/jpeg"],
    ["photo.JPEG", "image/jpeg", "image/jpeg"],
    ["scan.png", "image/png", "image/png"],
    ["id.pdf", "application/pdf", "application/pdf"],
    ["letter.doc", "", "application/msword"],
    [
      "contract.docx",
      "application/octet-stream",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  ];
  for (const [name, type, mimeType] of accepted) {
    const result = validateChatAttachment({ name, type, size: 1024 });
    assert.ok(result.ok, `${name} should be accepted`);
    assert.equal(result.ok && result.mimeType, mimeType);
  }
  assert.ok(validateChatAttachment({ name: "max.pdf", type: "application/pdf", size: CHAT_ATTACHMENT_MAX_BYTES }).ok);
  assert.equal(CHAT_ATTACHMENT_MAX_BYTES, 10 * 1024 * 1024);
});

test("chat attachments reject other types, mismatched types, empty and oversized files", () => {
  const rejected: Array<[{ name: string; type: string; size: number }, string]> = [
    [{ name: "clip.gif", type: "image/gif", size: 10 }, CHAT_ATTACHMENT_TYPE_ERROR],
    [{ name: "app.exe", type: "", size: 10 }, CHAT_ATTACHMENT_TYPE_ERROR],
    [{ name: "noextension", type: "application/pdf", size: 10 }, CHAT_ATTACHMENT_TYPE_ERROR],
    [{ name: "fake.pdf", type: "text/html", size: 10 }, CHAT_ATTACHMENT_TYPE_ERROR],
    [{ name: "photo.webp", type: "image/webp", size: 10 }, CHAT_ATTACHMENT_TYPE_ERROR],
    [{ name: "empty.png", type: "image/png", size: 0 }, CHAT_ATTACHMENT_EMPTY_ERROR],
    [{ name: "big.pdf", type: "application/pdf", size: CHAT_ATTACHMENT_MAX_BYTES + 1 }, CHAT_ATTACHMENT_SIZE_ERROR],
  ];
  for (const [file, error] of rejected) {
    assert.deepEqual(validateChatAttachment(file), { ok: false, error }, file.name);
  }
});

test("attachment names and sizes are formatted for display", () => {
  assert.equal(formatFileSize(500), "500 B");
  assert.equal(formatFileSize(2048), "2 KB");
  assert.equal(formatFileSize(1536 * 1024), "1.5 MB");
  assert.equal(formatFileSize(CHAT_ATTACHMENT_MAX_BYTES), "10 MB");
  assert.equal(attachmentTypeLabel("application/pdf"), "PDF");
  assert.equal(
    attachmentTypeLabel("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "DOCX",
  );
  assert.equal(chatAttachmentDisplayName("my/receipt.pdf", "pdf"), "myreceipt.pdf");
  const trimmed = chatAttachmentDisplayName(`${"a".repeat(300)}.docx`, "docx");
  assert.equal(trimmed.length, 255);
  assert.ok(trimmed.endsWith(".docx"));
  assert.equal(
    buildChatAttachmentPath("conversation-1", "user-1", "png", "object-1"),
    "conversation-1/user-1/object-1.png",
  );
});

test("attachment messages use the attachment RPC and map file metadata", async () => {
  const { client, calls } = clientWithResults([{ data: [{
    id: "message-2",
    conversation_id: "conversation-1",
    sender_id: "customer-1",
    sender_role: "customer",
    sender_name: "Guest customer",
    message_type: "text",
    body: "",
    created_at: "2026-10-01T02:00:00.000Z",
    edited_at: null,
    attachment_path: "conversation-1/customer-1/object-1.pdf",
    attachment_name: "valid-id.pdf",
    attachment_mime_type: "application/pdf",
    attachment_size_bytes: 2048,
  }], error: null }]);

  const message = await sendMessage(
    client,
    "conversation-1",
    "",
    "22222222-2222-4222-8222-222222222222",
    { path: "conversation-1/customer-1/object-1.pdf", name: "valid-id.pdf" },
  );
  assert.deepEqual(calls[0], {
    name: "send_chat_attachment_message",
    args: {
      p_conversation_id: "conversation-1",
      p_body: "",
      p_client_message_id: "22222222-2222-4222-8222-222222222222",
      p_attachment_path: "conversation-1/customer-1/object-1.pdf",
      p_attachment_name: "valid-id.pdf",
    },
  });
  assert.deepEqual(message.attachment, {
    path: "conversation-1/customer-1/object-1.pdf",
    name: "valid-id.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
  });
});

test("text-only messages and older rows have no attachment", async () => {
  const { client } = clientWithResults([{ data: [{
    id: "message-3",
    conversation_id: "conversation-1",
    sender_id: "admin-1",
    sender_role: "admin",
    sender_name: "Maddy & Cassy Support",
    message_type: "text",
    body: "Hello",
    created_at: "2026-10-01T02:00:00.000Z",
    edited_at: null,
  }], error: null }]);
  const [message] = await listMessages(client, "conversation-1");
  assert.equal(message.attachment, null);
});

test("attachment errors from the database become friendly messages", async () => {
  for (const [code, expected] of [
    ["CHAT_ATTACHMENT_TOO_LARGE", CHAT_ATTACHMENT_SIZE_ERROR],
    ["CHAT_ATTACHMENT_INVALID", CHAT_ATTACHMENT_TYPE_ERROR],
    ["CHAT_ATTACHMENT_NOT_FOUND", ATTACHMENT_NOT_UPLOADED_MESSAGE],
    ["CHAT_REPLY_REQUIRED", REPLY_REQUIRED_MESSAGE],
  ] as const) {
    const { client } = clientWithResults([{ data: null, error: { message: code } }]);
    await assert.rejects(
      sendMessage(client, "conversation-1", "", undefined, { path: "p", name: "a.pdf" }),
      { message: expected },
    );
  }
});

test("storage upload failures map to a specific, actionable message", () => {
  const cases: Array<[number, string, string]> = [
    // Bucket missing (attachment migration not applied).
    [400, JSON.stringify({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }), ATTACHMENTS_UNAVAILABLE_MESSAGE],
    [404, "", ATTACHMENTS_UNAVAILABLE_MESSAGE],
    // Storage policy rejected the insert.
    [400, JSON.stringify({ statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" }), ATTACHMENT_ACCESS_DENIED_MESSAGE],
    [403, "", ATTACHMENT_ACCESS_DENIED_MESSAGE],
    // Expired or invalid session token.
    [400, JSON.stringify({ statusCode: "400", error: "InvalidJWT", message: "\"exp\" claim timestamp check failed" }), CHAT_SESSION_EXPIRED_MESSAGE],
    [401, "", CHAT_SESSION_EXPIRED_MESSAGE],
    // Bucket-level size and type limits.
    [413, "", CHAT_ATTACHMENT_SIZE_ERROR],
    [400, JSON.stringify({ statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" }), CHAT_ATTACHMENT_SIZE_ERROR],
    [400, JSON.stringify({ statusCode: "415", error: "invalid_mime_type", message: "mime type image/gif is not supported" }), CHAT_ATTACHMENT_TYPE_ERROR],
    // Anything else is a generic retryable failure.
    [500, "Internal Server Error", ATTACHMENT_UPLOAD_FAILED_MESSAGE],
    [0, "", ATTACHMENT_UPLOAD_FAILED_MESSAGE],
  ];
  for (const [status, body, expected] of cases) {
    assert.equal(chatAttachmentUploadErrorMessage(status, body), expected, `${status} ${body}`);
  }
});

test("the attachment bucket is private and matches the client type and size rules", () => {
  assert.match(attachmentMigration, /'chat-attachments',\s*\n\s*'chat-attachments',\s*\n\s*false,\s*\n\s*10485760,/);
  for (const [extension, mimeType] of Object.entries(CHAT_ATTACHMENT_TYPES)) {
    assert.ok(attachmentMigration.includes(`'${mimeType}'`), `bucket is missing ${mimeType}`);
    assert.ok(
      attachmentMigration.includes(`when '${extension}' then '${mimeType}'`),
      `server type map is missing ${extension}`,
    );
  }
});

test("attachment storage access is limited to conversation participants", () => {
  assert.match(attachmentMigration, /for select to authenticated\s*\n\s*using \(\s*\n\s*bucket_id = 'chat-attachments'\s*\n\s*and private\.can_read_chat_attachment\(name\)/);
  assert.match(attachmentMigration, /for insert to authenticated\s*\n\s*with check \(\s*\n\s*bucket_id = 'chat-attachments'\s*\n\s*and private\.can_upload_chat_attachment\(name\)/);
  assert.match(attachmentMigration, /return private\.can_access_chat_conversation\(v_conversation_id, v_uid\);/);
  // Uploads land in the uploader's own folder.
  assert.match(attachmentMigration, /split_part\(p_name, '\/', 2\) <> v_uid::text/);
  assert.doesNotMatch(attachmentMigration, /to anon\b/);
});

test("attachment sends keep the profanity filter and count as one message", () => {
  assert.match(
    attachmentMigration,
    /if not v_is_admin and v_body <> '' and private\.chat_message_has_profanity\(v_body\) then\s*\n\s*raise exception 'CHAT_INAPPROPRIATE_LANGUAGE'/,
  );
  assert.match(
    attachmentMigration,
    /not v_is_admin\s*\n\s*and v_existing_message_id is null\s*\n\s*and private\.count_pending_customer_messages\(p_conversation_id\)\s*\n?\s*>=\s*private\.chat_customer_message_limit\(\)/,
  );
  // The stored object is re-checked before the message is saved.
  const objectCheck = attachmentMigration.indexOf("from storage.objects as stored_object");
  const insertIndex = attachmentMigration.indexOf("insert into public.chat_messages as inserted_message");
  assert.ok(objectCheck > 0 && objectCheck < insertIndex);
  // Text-only sends are left untouched.
  assert.doesNotMatch(attachmentMigration, /function public\.send_chat_message\(/);
  assert.doesNotMatch(attachmentMigration, /update public\.chat_messages/i);
});
