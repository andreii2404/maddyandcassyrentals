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
 */
export const supabaseImageLoader: ImageLoader = ({ src, width, quality }) => {
  const url = new URL(src.replace(PUBLIC_OBJECT_SEGMENT, RENDER_IMAGE_SEGMENT));
  url.searchParams.set("width", String(Math.min(width, 2500)));
  url.searchParams.set("quality", String(quality ?? 75));
  return url.toString();
};

/** Square, center-cropped variant for thumbnails. */
export const supabaseSquareImageLoader: ImageLoader = (props) => {
  const url = new URL(supabaseImageLoader(props));
  url.searchParams.set("height", url.searchParams.get("width") ?? String(props.width));
  url.searchParams.set("resize", "cover");
  return url.toString();
};
