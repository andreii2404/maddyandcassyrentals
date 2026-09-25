import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export const STORAGE_BUCKETS = {
  publicAssets: "public-assets",
  productImages: "product-images",
  profileImages: "profile-images",
  customerDocuments: "customer-documents",
  bookingDocuments: "booking-documents",
  paymentProofs: "payment-proofs",
  agreements: "agreements",
  receipts: "receipts",
  invoices: "invoices",
  conditionPhotos: "condition-photos",
} as const;

export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

const SIGNED_URL_TTL_SECONDS = 60 * 10;

/** Builds `<userId>/<bookingId>/<documentType>/<filename>` per the private-bucket path convention. */
export function buildPrivateDocumentPath(
  userId: string,
  bookingId: string,
  documentType: string,
  fileName: string,
): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${userId}/${bookingId}/${documentType}/${Date.now()}-${safeName}`;
}

export async function createSignedUrl(
  supabase: SupabaseClient<Database>,
  bucket: StorageBucket,
  path: string,
  expiresIn: number = SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Failed to create signed URL.");
  }
  return data.signedUrl;
}

export function getPublicUrl(
  supabase: SupabaseClient<Database>,
  bucket: StorageBucket,
  path: string,
): string {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
