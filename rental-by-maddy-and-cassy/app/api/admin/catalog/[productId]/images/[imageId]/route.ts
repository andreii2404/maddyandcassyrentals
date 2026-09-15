import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/lib/supabase/database.types";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";

const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const BUCKET = "product-images";

/** Scopes every lookup by product_id so a photo can never be read or mutated through the wrong product's URL. */
async function loadOwnedImage(supabase: SupabaseClient<Database>, productId: string, imageId: string) {
  const { data } = await supabase
    .from("product_images")
    .select("id, storage_path, is_primary")
    .eq("id", imageId)
    .eq("product_id", productId)
    .maybeSingle();
  return data;
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ productId: string; imageId: string }> },
): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-catalog-image", 20, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { productId, imageId } = await params;

    const image = await loadOwnedImage(supabase, productId, imageId);
    if (!image) return NextResponse.json({ error: "The photo no longer exists." }, { status: 404 });

    const { error: deleteError } = await supabase.from("product_images").delete().eq("id", imageId);
    if (deleteError) throw new Error(deleteError.message);

    await supabase.storage.from(BUCKET).remove([image.storage_path]);

    if (image.is_primary) {
      const { data: remaining } = await supabase
        .from("product_images")
        .select("id")
        .eq("product_id", productId)
        .order("sort_order", { ascending: true })
        .limit(1);
      const nextPrimaryId = remaining?.[0]?.id;
      if (nextPrimaryId) {
        await supabase.from("product_images").update({ is_primary: true }).eq("id", nextPrimaryId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Catalog image deletion failed", error);
    return NextResponse.json({ error: "The photo could not be deleted." }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string; imageId: string }> },
): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-catalog-image", 20, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { productId, imageId } = await params;
    const body = (await request.json().catch(() => null)) as { isPrimary?: boolean } | null;
    if (!body?.isPrimary) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const image = await loadOwnedImage(supabase, productId, imageId);
    if (!image) return NextResponse.json({ error: "The photo no longer exists." }, { status: 404 });

    const { error: clearError } = await supabase
      .from("product_images")
      .update({ is_primary: false })
      .eq("product_id", productId)
      .neq("id", imageId);
    if (clearError) throw new Error(clearError.message);

    const { error: setError } = await supabase
      .from("product_images")
      .update({ is_primary: true })
      .eq("id", imageId);
    if (setError) throw new Error(setError.message);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Catalog image primary update failed", error);
    return NextResponse.json({ error: "The main photo could not be updated." }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ productId: string; imageId: string }> },
): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-catalog-image", 20, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { productId, imageId } = await params;
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File)) {
      return NextResponse.json({ error: "Choose a JPG, PNG, or WebP image." }, { status: 400 });
    }
    const extension = ALLOWED_IMAGE_TYPES.get(image.type);
    if (!extension || image.size <= 0 || image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Use a JPG, PNG, or WebP image up to 10 MB." }, { status: 400 });
    }

    const existing = await loadOwnedImage(supabase, productId, imageId);
    if (!existing) return NextResponse.json({ error: "The photo no longer exists." }, { status: 404 });

    const storagePath = `${productId}/${randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, image, { contentType: image.type, upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { error: updateError } = await supabase
      .from("product_images")
      .update({ storage_path: storagePath })
      .eq("id", imageId);
    if (updateError) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      throw new Error(updateError.message);
    }

    await supabase.storage.from(BUCKET).remove([existing.storage_path]);

    const url = supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
    return NextResponse.json({ storagePath, url });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Catalog image replacement failed", error);
    return NextResponse.json({ error: "The product image could not be replaced." }, { status: 500 });
  }
}
