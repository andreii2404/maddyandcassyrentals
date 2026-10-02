import { NextResponse } from "next/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { enforceRateLimit, requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { validateSavedSignatureFile } from "@/src/lib/savedSignature";
import { createSignedUrl } from "@/src/lib/supabase/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "customer-documents";
const NO_STORE = { "Cache-Control": "private, no-store" };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

function extensionFor(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

/** Loads only the caller's current profile signature. No booking record is created. */
export async function GET() {
  try {
    const { user } = await requireUser();
    if (user.is_anonymous) return errorResponse("No saved signature was found.", 404);

    const admin = createAdminClient();
    const { data: document, error } = await admin
      .from("customer_documents")
      .select("storage_bucket, storage_path, mime_type, file_size_bytes")
      .eq("owner_user_id", user.id)
      .eq("document_type", "signature")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const path = document?.storage_path;
    if (!path || document.storage_bucket !== BUCKET) return errorResponse("No saved signature was found.", 404);
    if (!path.startsWith(`${user.id}/profile-signatures/`)) {
      throw new Error("The saved signature path is invalid.");
    }

    const { data, error: downloadError } = await admin.storage.from(BUCKET).download(path);
    if (downloadError || !data) throw downloadError ?? new Error("The saved signature could not be downloaded.");
    if (validateSavedSignatureFile(data)) throw new Error("The saved signature is invalid.");
    const url = await createSignedUrl(admin, BUCKET, path);
    return NextResponse.json({ url }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Saved signature lookup failed", error);
    return errorResponse("Your saved signature could not be loaded.", 500);
  }
}

/** Replaces the profile pointer only after the new private image is stored. */
export async function POST(request: Request) {
  try {
    enforceRateLimit(request, "saved-signature-upload", 12, 60_000);
    const { user } = await requireUser();
    if (user.is_anonymous) return errorResponse("Sign in to save a signature for future bookings.", 403);

    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) return errorResponse("Choose a file to upload.", 400);
    const validationError = validateSavedSignatureFile(file);
    if (validationError) return errorResponse(validationError, 400);

    const admin = createAdminClient();
    const { data: oldDocument, error: oldDocumentError } = await admin
      .from("customer_documents")
      .select("id, storage_path")
      .eq("owner_user_id", user.id)
      .eq("document_type", "signature")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (oldDocumentError) throw oldDocumentError;

    const path = `${user.id}/profile-signatures/${crypto.randomUUID()}.${extensionFor(file.type)}`;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { error: insertError } = await admin
      .from("customer_documents")
      .insert({
        owner_user_id: user.id,
        document_type: "signature",
        storage_bucket: BUCKET,
        storage_path: path,
        original_filename: file.name,
        mime_type: file.type,
        file_size_bytes: file.size,
        status: "active",
      });
    if (insertError) {
      await admin.storage.from(BUCKET).remove([path]);
      throw insertError;
    }

    if (oldDocument) {
      const { error: replaceError } = await admin
        .from("customer_documents")
        .update({ status: "replaced" })
        .eq("id", oldDocument.id)
        .eq("owner_user_id", user.id);
      if (replaceError) console.error("Old saved signature replacement failed", replaceError);
      const oldPath = oldDocument.storage_path;
      if (oldPath.startsWith(`${user.id}/profile-signatures/`)) {
        const { error: removeError } = await admin.storage.from(BUCKET).remove([oldPath]);
        if (removeError) console.error("Old saved signature cleanup failed", removeError);
      }
    }
    return NextResponse.json({ saved: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Saved signature upload failed", error);
    return errorResponse("Your signature could not be saved. Please try again.", 500);
  }
}
