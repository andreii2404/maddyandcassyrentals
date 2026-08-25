/**
 * Uploads a folder of real product photos into Supabase storage
 * ("product-images" bucket) and registers them in the product_images table so
 * the storefront catalog card and product gallery display them.
 *
 * Usage:
 *   npx tsx scripts/uploadProductPhotos.ts "<photos folder>" "<product name or slug>" [--color "Blue"]
 *
 * Examples:
 *   npx tsx scripts/uploadProductPhotos.ts "src/products/IPHONE 17 PRO MAX BLUE" "iphone-17-pro-max" --color Blue
 *   npx tsx scripts/uploadProductPhotos.ts "src/products/CANON — G7X MARK III" "canon-g7x"
 *
 * Requires SUPABASE_SECRET_KEY (service role) plus NEXT_PUBLIC_SUPABASE_URL in
 * the project .env. The first photo ever uploaded for a product becomes the
 * primary catalog image; later batches keep the existing primary. A --color
 * tag is stored in alt_text as "[Color] ..." and drives the storefront color
 * picker.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  let raw = "";
  try {
    raw = readFileSync(join(PROJECT_ROOT, ".env"), "utf8");
  } catch {
    throw new Error(`Could not read ${join(PROJECT_ROOT, ".env")}`);
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (!env[key]) env[key] = value;
  }
  return env;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function main() {
  const args = process.argv.slice(2);
  const colorIndex = args.indexOf("--color");
  const color = colorIndex >= 0 ? (args[colorIndex + 1] ?? "") : "";
  if (colorIndex >= 0) args.splice(colorIndex, 2);
  const [folderArg, matchArg] = args;
  if (!folderArg || !matchArg) {
    console.error('Usage: npx tsx scripts/uploadProductPhotos.ts "<photos folder>" "<product name or slug>" [--color "Blue"]');
    process.exit(1);
  }

  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env");
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: products, error: productError } = await supabase
    .from("products")
    .select("id, slug, name");
  if (productError) throw new Error(productError.message);

  const needle = normalize(matchArg);
  const allProducts = products ?? [];
  const exact = allProducts.filter((product) =>
    normalize(product.slug) === needle || normalize(product.name) === needle,
  );
  const candidates = exact.length > 0 ? exact : allProducts.filter((product) =>
    normalize(product.slug).includes(needle) || normalize(product.name).includes(needle),
  );
  if (candidates.length !== 1) {
    console.error(candidates.length === 0 ? "No product matched. Available products:" : "Multiple products matched, be more specific:");
    for (const product of candidates.length > 0 ? candidates : allProducts) {
      console.error(` - ${product.slug} | ${product.name}`);
    }
    process.exit(1);
  }
  const product = candidates[0];
  console.log(`Target product: ${product.name} (${product.id})`);

  const isAbsolute = /^[A-Za-z]:[\\/]/.test(folderArg) || folderArg.startsWith("/");
  const folder = isAbsolute ? folderArg : join(PROJECT_ROOT, folderArg);
  const files = readdirSync(folder)
    .filter((file) => /\.(jpe?g|png|webp)$/i.test(file))
    .sort(naturalSort);
  if (files.length === 0) throw new Error(`No JPG/PNG/WebP photos found in ${folder}`);

  const { data: existing, error: existingError } = await supabase
    .from("product_images")
    .select("id, sort_order")
    .eq("product_id", product.id);
  if (existingError) throw new Error(existingError.message);
  const { data: existingPrimary } = await supabase
    .from("product_images")
    .select("id")
    .eq("product_id", product.id)
    .eq("is_primary", true)
    .maybeSingle();
  console.log(`Existing images on product: ${(existing ?? []).length}. Uploading ${files.length} new photo(s).`);

  // Only the very first batch for a product installs a primary image; later
  // batches (for example a second color) keep the current catalog photo.
  const installPrimary = (existing ?? []).length === 0 || !existingPrimary;
  if (installPrimary && (existing ?? []).length > 0) {
    const { error: demoteError } = await supabase
      .from("product_images")
      .update({ is_primary: false })
      .eq("product_id", product.id);
    if (demoteError) throw new Error(demoteError.message);
  }
  const baseSortOrder = (existing ?? []).reduce(
    (max, image) => Math.max(max, image.sort_order ?? 0),
    -1,
  ) + 1;

  let uploaded = 0;
  for (const [index, file] of files.entries()) {
    const bytes = readFileSync(join(folder, file));
    const extension = (file.split(".").pop() ?? "jpg").toLowerCase();
    const contentType =
      extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
    const storagePath = `${product.id}/${randomUUID()}.${extension === "jpeg" ? "jpg" : extension}`;
    const altText = color
      ? `[${color}] ${product.name} photo ${index + 1}`
      : `${product.name} photo ${index + 1}`;

    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(storagePath, bytes, { contentType, upsert: false });
    if (uploadError) throw new Error(`${file}: ${uploadError.message}`);

    const { error: insertError } = await supabase.from("product_images").insert({
      product_id: product.id,
      storage_bucket: "product-images",
      storage_path: storagePath,
      alt_text: altText,
      sort_order: baseSortOrder + index,
      is_primary: installPrimary && index === 0,
    });
    if (insertError) {
      await supabase.storage.from("product-images").remove([storagePath]);
      throw new Error(`${file}: ${insertError.message}`);
    }
    uploaded += 1;
    console.log(`Uploaded ${file}`);
  }

  const { data: primaryImage } = await supabase
    .from("product_images")
    .select("storage_path")
    .eq("product_id", product.id)
    .eq("is_primary", true)
    .maybeSingle();
  const publicUrl = primaryImage
    ? supabase.storage.from("product-images").getPublicUrl(primaryImage.storage_path).data.publicUrl
    : "";
  console.log(`Done. ${uploaded} photo(s) added to "${product.name}".`);
  console.log(`Primary image URL: ${publicUrl}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
