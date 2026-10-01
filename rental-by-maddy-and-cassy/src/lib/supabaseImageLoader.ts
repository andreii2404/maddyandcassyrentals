import type { ImageLoader } from "next/image";

const PUBLIC_OBJECT_SEGMENT = "/storage/v1/object/public/";
const RENDER_IMAGE_SEGMENT = "/storage/v1/render/image/public/";

/** True when `src` is a public Supabase Storage object URL that can be resized on the fly. */
export function isSupabasePublicImage(src: string): boolean {
  return src.startsWith("https://") && src.includes(".supabase.co" + PUBLIC_OBJECT_SEGMENT);
}

/**
 * Serves product photos through Supabase's image transformation endpoint so the
 * browser downloads a right-sized image instead of the multi-megabyte original.
 * Routing them through the Next.js optimizer instead times out (504) when several
 * originals are requested at once, which left gallery thumbnails broken.
 *
 * `resize=contain` is required: with only `width` set, Supabase defaults to
 * `cover` and keeps the original height, returning a distorted tall strip
 * (e.g. 640x4284 for a 4284x4284 photo) instead of a proportional resize.
 */
export const supabaseImageLoader: ImageLoader = ({ src, width, quality }) => {
  const url = new URL(src.replace(PUBLIC_OBJECT_SEGMENT, RENDER_IMAGE_SEGMENT));
  url.searchParams.set("width", String(Math.min(width, 2500)));
  url.searchParams.set("resize", "contain");
  url.searchParams.set("quality", String(quality ?? 75));
  return url.toString();
};
