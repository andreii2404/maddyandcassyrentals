import { NextResponse } from "next/server";
import { requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createSignedUrl, type StorageBucket } from "@/src/lib/supabase/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns a short-lived signed URL so the customer can preview one of their
 * own stored verification documents. Only the document's owner can call this;
 * the storage lookup is scoped to their user id.
 */
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const documentId = new URL(request.url).searchParams.get("documentId") ?? "";
    if (!UUID_PATTERN.test(documentId)) {
      throw new RequestSecurityError("The document reference is invalid.", 400);
    }

    const { data: document, error } = await supabase
      .from("customer_documents")
      .select("storage_bucket, storage_path")
      .eq("id", documentId)
      .eq("owner_user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!document) {
      return NextResponse.json({ error: "This document could not be found." }, { status: 404 });
    }

    const url = await createSignedUrl(
      supabase,
      document.storage_bucket as StorageBucket,
      document.storage_path,
    );
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Verification document preview failed", error);
    return NextResponse.json(
      { error: "This document could not be opened." },
      { status: 500 },
    );
  }
}
