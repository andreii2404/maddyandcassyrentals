import { createClient } from "@/src/lib/supabase/client";
import type { StorageBucket } from "@/src/lib/supabase/storage";
import { getBookingFileUrl } from "@/src/services/bookingDetailService";

/** Where a booking file lives: a private storage object, or a same-site route that builds the file. */
export type BookingFileSource =
  | { kind: "storage"; bucket: StorageBucket; path: string }
  | { kind: "api"; url: string };

/** One file an admin can preview in the page or download. */
export interface BookingFileTarget {
  title: string;
  fileName: string;
  mimeType?: string;
  source: BookingFileSource;
}

export type BookingFileKind = "pdf" | "image" | "other";

/** Builds the target for a private storage file, naming it after the stored file unless told otherwise. */
export function storageFileTarget(
  title: string,
  bucket: string,
  path: string,
  options: { fileName?: string; mimeType?: string } = {},
): BookingFileTarget {
  return {
    title,
    fileName: options.fileName || fileNameFromPath(path),
    mimeType: options.mimeType,
    source: { kind: "storage", bucket: bucket as StorageBucket, path },
  };
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function fileNameFromPath(path: string): string {
  return path.split("/").pop() || "file";
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/** The exact content type to preview a file with, or null when it can't be shown in the page. */
function previewContentType(fileName: string, mimeType?: string): string | null {
  const mime = mimeType?.toLowerCase() ?? "";
  const extension = extensionOf(fileName);
  if (mime.includes("pdf") || extension === "pdf") return "application/pdf";
  if (Object.values(IMAGE_TYPES).includes(mime)) return mime;
  return IMAGE_TYPES[extension] ?? null;
}

export function detectFileKind(fileName: string, mimeType?: string): BookingFileKind {
  const contentType = previewContentType(fileName, mimeType);
  if (!contentType) return "other";
  return contentType === "application/pdf" ? "pdf" : "image";
}

/**
 * Fetches a booking file as a blob. Nothing is saved to the admin's computer here,
 * so this is safe to use for previews.
 */
export async function loadBookingFileBlob(target: BookingFileTarget): Promise<Blob> {
  const response =
    target.source.kind === "storage"
      ? await fetch(await getBookingFileUrl(createClient(), target.source.bucket, target.source.path), {
          cache: "no-store",
        })
      : await fetch(target.source.url, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("The file could not be loaded.");

  const blob = await response.blob();
  // Storage can label files generically, and a PDF or image only previews when typed correctly.
  const contentType = previewContentType(target.fileName, target.mimeType);
  return contentType && blob.type !== contentType ? new Blob([blob], { type: contentType }) : blob;
}

/** Saves a blob to the admin's computer. Only called from an explicit Download button. */
export function saveBlobAs(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function downloadBookingFile(target: BookingFileTarget): Promise<void> {
  saveBlobAs(await loadBookingFileBlob(target), target.fileName);
}
