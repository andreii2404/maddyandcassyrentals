/**
 * The administrator's drawn countersignature is submitted as a PNG data URL
 * (the signature pad's trimmed canvas). Everything that crosses the API
 * boundary is validated here before it is stored or embedded in the final
 * Rental Agreement PDF.
 */

export const BUSINESS_SIGNATURE_CONTENT_TYPE = "image/png";
export const BUSINESS_SIGNATURE_METHOD = "drawn_admin_signature";

/** A trimmed on-screen signature is a few KB; 1 MB is a generous ceiling. */
const MAX_SIGNATURE_BYTES = 1_000_000;
const MAX_SIGNATURE_DIMENSION = 4096;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * Returns the decoded PNG bytes, or null when the value is not a well-formed
 * PNG data URL of a sensible size.
 */
export function decodeBusinessSignatureDataUrl(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  // Base64 inflates by 4/3; reject oversized payloads before decoding them.
  if (value.length > Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 64) return null;

  const match = PNG_DATA_URL.exec(value);
  if (!match) return null;

  const bytes = Uint8Array.from(Buffer.from(match[1], "base64"));
  // IHDR is always the first chunk: 8 magic + 4 length + 4 type + width + height.
  if (bytes.length < 24 || bytes.length > MAX_SIGNATURE_BYTES) return null;
  if (!PNG_MAGIC.every((byte, index) => bytes[index] === byte)) return null;
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1) return null;
  if (width > MAX_SIGNATURE_DIMENSION || height > MAX_SIGNATURE_DIMENSION) return null;

  return bytes;
}

export function businessSignatureStoragePath(
  adminUserId: string,
  bookingId: string,
  now: number = Date.now(),
): string {
  return `${adminUserId}/${bookingId}/business-signature/${now}-business-signature.png`;
}
