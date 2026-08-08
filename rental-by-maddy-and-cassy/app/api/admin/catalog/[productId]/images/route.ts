import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";

const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-catalog-image", 20, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { productId } = await params;
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File)) {
      return NextResponse.json({ error: "Choose a JPG, PNG, or WebP image." }, { status: 400 });
    }
    const extension = ALLOWED_IMAGE_TYPES.get(image.type);
    if (!extension || image.size <= 0 || image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Use a JPG, PNG, or WebP image up to 10 MB." }, { status: 400 });
    }

    const { data: product } = await supabase.from("products").select("id, name").eq("id", productId).maybeSingle();
    if (!product) return NextResponse.json({ error: "The product no longer exists." }, { status: 404 });

    const storagePath = `${productId}/${randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(storagePath, image, { contentType: image.type, upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { data: currentImages } = await supabase
      .from("product_images")
      .select("id")
      .eq("product_id", productId);
    const { data: metadata, error: metadataError } = await supabase
      .from("product_images")
      .insert({
        product_id: productId,
        storage_bucket: "product-images",
        storage_path: storagePath,
        alt_text: `${product.name} rental product image`,
        sort_order: 0,
        is_primary: (currentImages ?? []).length === 0,
      })
      .select("id")
      .single();
    if (metadataError || !metadata) {
      await supabase.storage.from("product-images").remove([storagePath]);
      throw new Error(metadataError?.message ?? "The image record could not be created.");
    }

    if ((currentImages ?? []).length > 0) {
      const { error: previousPrimaryError } = await supabase
        .from("product_images")
        .update({ is_primary: false })
        .eq("product_id", productId)
        .neq("id", metadata.id);
      const { error: newPrimaryError } = await supabase
        .from("product_images")
        .update({ is_primary: true })
        .eq("id", metadata.id);
      if (previousPrimaryError || newPrimaryError) {
        await supabase.from("product_images").delete().eq("id", metadata.id);
        await supabase.storage.from("product-images").remove([storagePath]);
        const fallbackId = currentImages?.[0]?.id;
        if (fallbackId) await supabase.from("product_images").update({ is_primary: true }).eq("id", fallbackId);
        throw new Error(previousPrimaryError?.message ?? newPrimaryError?.message ?? "The primary image could not be updated.");
      }
    }

    const url = supabase.storage.from("product-images").getPublicUrl(storagePath).data.publicUrl;
    return NextResponse.json({ storagePath, url }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Catalog image upload failed", error);
    return NextResponse.json({ error: "The product image could not be uploaded." }, { status: 500 });
  }
}
