// Chat attachment rules shared by the composer and tests. The database repeats
// them: the chat-attachments bucket enforces the size limit and MIME types, and
// send_chat_attachment_message re-checks the stored object before linking it
// (see supabase/migrations/20261001200000_chat_message_attachments.sql). Keep
// the extensions, MIME types and size limit identical in both places.

export const CHAT_ATTACHMENT_BUCKET = "chat-attachments";

/** 10 MB per file. */
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Canonical MIME type for each accepted file extension. */
export const CHAT_ATTACHMENT_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export type ChatAttachmentExtension = keyof typeof CHAT_ATTACHMENT_TYPES;
export type ChatAttachmentMimeType = (typeof CHAT_ATTACHMENT_TYPES)[ChatAttachmentExtension];

/** Value for the file input's `accept` attribute. */
export const CHAT_ATTACHMENT_ACCEPT = [
  ...Object.keys(CHAT_ATTACHMENT_TYPES).map((extension) => `.${extension}`),
  ...new Set(Object.values(CHAT_ATTACHMENT_TYPES)),
].join(",");

export const CHAT_ATTACHMENT_TYPE_ERROR =
  "This file type isn't supported. Attach a JPG, PNG, PDF, DOC, or DOCX file.";
export const CHAT_ATTACHMENT_SIZE_ERROR = "This file is larger than 10 MB. Choose a smaller file.";
export const CHAT_ATTACHMENT_EMPTY_ERROR = "This file is empty. Choose a different file.";

export type ChatAttachmentValidation =
  | { ok: true; extension: ChatAttachmentExtension; mimeType: ChatAttachmentMimeType }
  | { ok: false; error: string };

function isAllowedExtension(value: string): value is ChatAttachmentExtension {
  return Object.prototype.hasOwnProperty.call(CHAT_ATTACHMENT_TYPES, value);
}

/** Lower-case extension of a file name, without the dot ("" when there is none). */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1).toLowerCase() : "";
}

/**
 * Validates a file before it is uploaded. The extension decides the stored MIME
 * type; a browser-reported type is accepted only when it agrees with the
 * extension (or is missing/generic, which Windows reports for Word files when
 * Office is not installed).
 */
export function validateChatAttachment(
  file: Pick<File, "name" | "size" | "type">,
): ChatAttachmentValidation {
  const extension = fileExtension(file.name);
  if (!isAllowedExtension(extension)) return { ok: false, error: CHAT_ATTACHMENT_TYPE_ERROR };

  const mimeType = CHAT_ATTACHMENT_TYPES[extension];
  const reportedType = file.type.trim().toLowerCase();
  if (reportedType && reportedType !== "application/octet-stream" && reportedType !== mimeType) {
    return { ok: false, error: CHAT_ATTACHMENT_TYPE_ERROR };
  }

  if (file.size <= 0) return { ok: false, error: CHAT_ATTACHMENT_EMPTY_ERROR };
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) return { ok: false, error: CHAT_ATTACHMENT_SIZE_ERROR };

  return { ok: true, extension, mimeType };
}

export function isImageAttachment(mimeType: string): boolean {
  return mimeType === "image/jpeg" || mimeType === "image/png";
}

/** Short label for the file type, e.g. "PDF" or "DOCX". */
export function attachmentTypeLabel(mimeType: string, fileName = ""): string {
  switch (mimeType) {
    case "image/jpeg":
      return "JPG";
    case "image/png":
      return "PNG";
    case "application/pdf":
      return "PDF";
    case "application/msword":
      return "DOC";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "DOCX";
    default:
      return fileExtension(fileName).toUpperCase() || "FILE";
  }
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 10 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}

/**
 * Display name stored with the message: control characters and path
 * separators removed, at most 255 characters, extension kept (the server
 * requires it to match the stored file).
 */
export function chatAttachmentDisplayName(fileName: string, extension: ChatAttachmentExtension): string {
  const cleaned = fileName.replace(/[\u0000-\u001f\u007f/\\]/g, "").trim();
  const suffix = `.${extension}`;
  if (!cleaned.toLowerCase().endsWith(suffix)) return `attachment${suffix}`;
  if (cleaned.length <= 255) return cleaned;
  const original = cleaned.slice(cleaned.length - suffix.length);
  return `${cleaned.slice(0, 255 - suffix.length).trimEnd()}${original}`;
}

/** Storage path: <conversation id>/<uploader id>/<random id>.<extension>. */
export function buildChatAttachmentPath(
  conversationId: string,
  userId: string,
  extension: ChatAttachmentExtension,
  objectId: string = crypto.randomUUID(),
): string {
  return `${conversationId}/${userId}/${objectId}.${extension}`;
}
