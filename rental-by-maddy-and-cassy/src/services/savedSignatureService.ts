import { validateSavedSignatureFile } from "@/src/lib/savedSignature";

const URL = "/api/account/signature";

export async function loadSavedSignature(): Promise<string | null> {
  const response = await fetch(URL, { credentials: "same-origin" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Your saved signature could not be loaded.");
  const body = (await response.json()) as { url?: unknown };
  if (typeof body.url !== "string") throw new Error("Your saved signature could not be loaded.");
  const imageResponse = await fetch(body.url, { credentials: "omit" });
  if (!imageResponse.ok) throw new Error("Your saved signature could not be loaded.");
  const blob = await imageResponse.blob();
  if (validateSavedSignatureFile(blob)) throw new Error("Your saved signature could not be loaded.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parts: string[] = [];
  // Chunk on a multiple of three so only the final base64 segment is padded.
  for (let offset = 0; offset < bytes.length; offset += 24_576) {
    let binary = "";
    for (const byte of bytes.subarray(offset, offset + 24_576)) {
      binary += String.fromCharCode(byte);
    }
    parts.push(btoa(binary));
  }
  return `data:${blob.type};base64,${parts.join("")}`;
}

export async function saveSavedSignature(file: File): Promise<void> {
  const error = validateSavedSignatureFile(file);
  if (error) throw new Error(error);
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(URL, {
    method: "POST",
    credentials: "same-origin",
    body: formData,
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(typeof body?.error === "string" ? body.error : "Your signature could not be saved.");
}
