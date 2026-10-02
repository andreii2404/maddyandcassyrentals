import assert from "node:assert/strict";
import test from "node:test";
import { canApplySavedSignature, validateSavedSignatureFile } from "../src/lib/savedSignature";
import { loadSavedSignature, saveSavedSignature } from "../src/services/savedSignatureService";

test("saved signature fills only an untouched empty agreement", () => {
  assert.equal(canApplySavedSignature(null, false), true);
  assert.equal(canApplySavedSignature("data:image/png;base64,local", false), false);
  assert.equal(canApplySavedSignature(null, true), false);
});

test("saved signature uses the booking signature file limits", () => {
  assert.equal(validateSavedSignatureFile({ size: 1, type: "image/png" }), null);
  assert.equal(validateSavedSignatureFile({ size: 4 * 1024 * 1024, type: "image/webp" }), null);
  assert.equal(validateSavedSignatureFile({ size: 0, type: "image/png" }), "Choose a file to upload.");
  assert.equal(validateSavedSignatureFile({ size: 4 * 1024 * 1024 + 1, type: "image/jpeg" }), "Each file must be 4MB or smaller.");
  assert.equal(validateSavedSignatureFile({ size: 1, type: "image/svg+xml" }), "The selected file type is not supported.");
});

test("loading an account without a saved signature keeps the agreement empty", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });
  try {
    assert.equal(await loadSavedSignature(), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loading a saved signature returns its preview for a future agreement", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes("/api/account/signature")
    ? Response.json({ url: "https://signed.example/signature.png" })
    : new Response(new Blob(["signature"], { type: "image/png" }));
  try {
    assert.equal(await loadSavedSignature(), "data:image/png;base64,c2lnbmF0dXJl");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("saved signature preview stays intact across encoding chunks", async () => {
  const bytes = Uint8Array.from({ length: 24_577 }, (_, index) => index % 251);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes("/api/account/signature")
    ? Response.json({ url: "https://signed.example/signature.png" })
    : new Response(new Blob([bytes], { type: "image/png" }));
  try {
    assert.equal(await loadSavedSignature(), `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("saving a replacement sends the original image to the profile endpoint", async () => {
  const file = new File(["signature"], "signature.png", { type: "image/png" });
  const originalFetch = globalThis.fetch;
  let sentFile: File | null = null;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "/api/account/signature");
    assert.equal(init?.method, "POST");
    sentFile = (init?.body as FormData).get("file") as File;
    return Response.json({ saved: true });
  };
  try {
    await saveSavedSignature(file);
    assert.equal(sentFile, file);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
