// End-to-end check of chat file attachments against the Supabase project in
// .env.local. Run it after applying
// supabase/migrations/20261001200000_chat_message_attachments.sql:
//
//   CHAT_TEST_ADMIN_EMAIL=... CHAT_TEST_ADMIN_PASSWORD=... npx tsx scripts/verifyChatAttachments.ts
//
// It creates two temporary anonymous guests and one conversation, exchanges an
// image (customer -> admin) and a PDF (admin -> customer), checks that files
// stay private to the conversation, then deletes everything it created.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { CHAT_ATTACHMENT_BUCKET, buildChatAttachmentPath } from "../src/lib/chatAttachments";
import {
  ATTACHMENT_NOT_UPLOADED_MESSAGE,
  createAttachmentUrls,
  getOrCreateConversation,
  listMessages,
  sendMessage,
} from "../src/services/messagingService";

type Client = SupabaseClient<Database>;

function loadEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].trim().replace(/^"|"$/g, "");
  }
  return { ...values, ...process.env } as Record<string, string>;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = env.SUPABASE_SECRET_KEY;
const adminEmail = env.CHAT_TEST_ADMIN_EMAIL;
const adminPassword = env.CHAT_TEST_ADMIN_PASSWORD;
if (!url || !publishableKey || !secretKey || !adminEmail || !adminPassword) {
  console.error(
    "Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY " +
    "(.env.local) and CHAT_TEST_ADMIN_EMAIL / CHAT_TEST_ADMIN_PASSWORD for an existing admin account.",
  );
  process.exit(1);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient<Database>(url, secretKey, options);
const newClient = (): Client => createClient<Database>(url, publishableKey, options);

// 1x1 PNG and a minimal PDF.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const created = { users: [] as string[], conversations: [] as string[], paths: [] as string[] };

async function signInGuest(): Promise<{ client: Client; userId: string }> {
  const client = newClient();
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`Anonymous sign-in failed: ${error?.message}`);
  created.users.push(data.user.id);
  return { client, userId: data.user.id };
}

async function upload(client: Client, path: string, body: Buffer, contentType: string) {
  return client.storage.from(CHAT_ATTACHMENT_BUCKET).upload(path, body, { contentType, upsert: false });
}

async function fetchSigned(client: Client, path: string): Promise<Buffer> {
  const urls = await createAttachmentUrls(client, [path]);
  const signed = urls.get(path);
  assert.ok(signed, `no signed URL for ${path}`);
  const response = await fetch(signed);
  assert.equal(response.status, 200, `signed URL fetch for ${path}`);
  return Buffer.from(await response.arrayBuffer());
}

async function step(name: string, run: () => Promise<void>) {
  await run();
  console.log(`ok - ${name}`);
}

async function main() {
  const { client: guest, userId: guestId } = await signInGuest();
  const { client: outsider, userId: outsiderId } = await signInGuest();

  const admin = newClient();
  const { error: adminError } = await admin.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
  if (adminError) throw new Error(`Admin sign-in failed: ${adminError.message}`);
  const { data: adminUser } = await admin.auth.getUser();
  const adminId = adminUser.user!.id;

  const conversationId = await getOrCreateConversation(guest);
  created.conversations.push(conversationId);

  const imagePath = buildChatAttachmentPath(conversationId, guestId, "png");
  await step("guest uploads an image into their own conversation folder", async () => {
    const { error } = await upload(guest, imagePath, PNG, "image/png");
    assert.equal(error, null, error?.message);
    created.paths.push(imagePath);
  });

  await step("guest sends the image (customer -> admin)", async () => {
    const sent = await sendMessage(guest, conversationId, "", undefined, { path: imagePath, name: "photo.png" });
    assert.equal(sent.senderRole, "customer");
    assert.deepEqual(sent.attachment, { path: imagePath, name: "photo.png", mimeType: "image/png", sizeBytes: PNG.length });
  });

  await step("admin sees the image and can open it", async () => {
    const messages = await listMessages(admin, conversationId);
    assert.ok(messages.some((message) => message.attachment?.path === imagePath));
    assert.deepEqual(await fetchSigned(admin, imagePath), PNG);
  });

  const pdfPath = buildChatAttachmentPath(conversationId, adminId, "pdf");
  await step("admin uploads and sends a PDF (admin -> customer)", async () => {
    const { error } = await upload(admin, pdfPath, PDF, "application/pdf");
    assert.equal(error, null, error?.message);
    created.paths.push(pdfPath);
    const sent = await sendMessage(admin, conversationId, "Here is your form.", undefined, { path: pdfPath, name: "form.pdf" });
    assert.equal(sent.senderRole, "admin");
    assert.equal(sent.attachment?.mimeType, "application/pdf");
  });

  await step("guest sees both attachments after a fresh load and can open the PDF", async () => {
    const reloaded = newClient();
    const { data: sessionData } = await guest.auth.getSession();
    await reloaded.auth.setSession({
      access_token: sessionData.session!.access_token,
      refresh_token: sessionData.session!.refresh_token,
    });
    const paths = (await listMessages(reloaded, conversationId)).flatMap((message) => message.attachment ? [message.attachment.path] : []);
    assert.deepEqual(paths.sort(), [imagePath, pdfPath].sort());
    assert.deepEqual(await fetchSigned(reloaded, pdfPath), PDF);
  });

  await step("a failed upload never creates a message", async () => {
    const before = (await listMessages(guest, conversationId)).length;
    const missingPath = buildChatAttachmentPath(conversationId, guestId, "pdf");
    await assert.rejects(
      sendMessage(guest, conversationId, "", undefined, { path: missingPath, name: "missing.pdf" }),
      { message: ATTACHMENT_NOT_UPLOADED_MESSAGE },
    );
    assert.equal((await listMessages(guest, conversationId)).length, before);
  });

  await step("the bucket rejects disallowed file types", async () => {
    const path = buildChatAttachmentPath(conversationId, guestId, "png");
    const { error } = await upload(guest, path, Buffer.from("<html></html>"), "text/html");
    assert.ok(error, "text/html upload should be rejected");
  });

  await step("another guest cannot read, list or upload into this conversation", async () => {
    const urls = await createAttachmentUrls(outsider, [imagePath, pdfPath]);
    assert.equal(urls.size, 0);
    const { data: listed } = await outsider.storage.from(CHAT_ATTACHMENT_BUCKET).list(conversationId);
    assert.equal(listed?.length ?? 0, 0);
    const own = await upload(outsider, buildChatAttachmentPath(conversationId, outsiderId, "png"), PNG, "image/png");
    assert.ok(own.error, "outsider upload into a foreign conversation should be rejected");
    const spoofed = await upload(outsider, buildChatAttachmentPath(conversationId, guestId, "png"), PNG, "image/png");
    assert.ok(spoofed.error, "outsider upload into the guest's folder should be rejected");
  });

  await step("a sent attachment cannot be deleted by its uploader", async () => {
    await guest.storage.from(CHAT_ATTACHMENT_BUCKET).remove([imagePath]);
    assert.deepEqual(await fetchSigned(admin, imagePath), PNG);
  });
}

async function cleanup() {
  if (created.paths.length) await service.storage.from(CHAT_ATTACHMENT_BUCKET).remove(created.paths);
  for (const id of created.conversations) await service.from("chat_conversations").delete().eq("id", id);
  for (const id of created.users) await service.auth.admin.deleteUser(id);
}

main()
  .then(() => console.log("All chat attachment checks passed."))
  .catch((error) => {
    console.error("FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => cleanup().catch((error) => console.error("Cleanup failed:", error)));
