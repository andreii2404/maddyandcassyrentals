import assert from "node:assert/strict";
import test from "node:test";
import { patchAgreementDraft } from "../src/lib/patchAgreementDraft";
import { createEmptyDraft, type ReservationDraft } from "../src/types/reservationDraft";
import { submitBookingDocuments } from "../src/services/bookingSubmissionService";

test("selecting an upload retains the method when the signature preview arrives", () => {
  const file = new File(["signature"], "signature.png", { type: "image/png" });
  const selected = patchAgreementDraft(createEmptyDraft(), {
    signatureMethod: "uploaded",
    signatureDataUrl: null,
    signatureFile: null,
  });
  const previewed = patchAgreementDraft(selected, {
    signatureDataUrl: "data:image/png;base64,c2lnbmF0dXJl",
    signatureFile: file,
  });

  assert.equal(previewed.agreement.signatureMethod, "uploaded");
  assert.equal(previewed.agreement.signatureDataUrl, "data:image/png;base64,c2lnbmF0dXJl");
  assert.equal(previewed.agreement.signatureFile, file);
});

function completeDraft(): ReservationDraft {
  const draft = createEmptyDraft();
  draft.requirements.idOneFile = new File(["id"], "id-one.png", { type: "image/png" });
  draft.requirements.idTwoFile = new File(["id"], "id-two.png", { type: "image/png" });
  draft.requirements.selfieFile = new File(["selfie"], "selfie.png", { type: "image/png" });
  draft.requirements.facebookLink = "https://facebook.com/customer";
  draft.requirements.instagramLink = "https://instagram.com/customer";
  draft.requirements.emergencyContact = {
    fullName: "Emergency Contact",
    relationship: "Parent",
    phone: "09123456789",
    facebookLink: "https://facebook.com/contact",
    idFile: new File(["id"], "emergency.png", { type: "image/png" }),
  };
  draft.agreement = {
    ...draft.agreement,
    infoAccurate: true,
    agreedToTerms: true,
    understoodRentalRules: true,
    authorizedESignature: true,
    readPrivacyNotice: true,
    emergencyContactAuthorized: true,
    typedFullName: "Customer Name",
    signatureMethod: "uploaded",
    signatureDataUrl: "data:image/png;base64,cHJldmlldw==",
  };
  return draft;
}

test("submitting an uploaded signature sends the selected file to the existing upload endpoint", async () => {
  const signature = new File(["original signature bytes"], "my-signature.png", { type: "image/png" });
  const draft = completeDraft();
  draft.agreement.signatureFile = signature;

  const originalFetch = globalThis.fetch;
  let uploadedSignature: File | null = null;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/documents/upload")) {
      if (url.includes("kind=signature")) {
        uploadedSignature = (init?.body as FormData).get("file") as File;
      }
      return Response.json({ path: "uploaded/path" });
    }
    return Response.json({});
  };

  try {
    await submitBookingDocuments("booking-1", draft);
    assert.equal(uploadedSignature, signature);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a saved signature is converted and sent through the existing booking upload", async () => {
  const draft = completeDraft();
  const originalFetch = globalThis.fetch;
  const uploadedFiles: File[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("kind=signature")) {
      uploadedFiles.push((init?.body as FormData).get("file") as File);
    }
    return url.includes("/documents/upload")
      ? Response.json({ path: "uploaded/path" })
      : Response.json({});
  };

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: { atob }, configurable: true });
  try {
    await submitBookingDocuments("booking-1", draft);
    const uploadedSignature = uploadedFiles[0];
    assert.ok(uploadedSignature);
    assert.equal(uploadedSignature.type, "image/png");
    assert.equal(await uploadedSignature.text(), "preview");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
