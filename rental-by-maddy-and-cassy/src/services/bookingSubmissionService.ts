import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/lib/supabase/database.types";
import type { Product } from "@/types/product";
import type { ReservationDraft } from "@/src/types/reservationDraft";
import { formatCustomerAddress, getDayCount } from "@/src/types/reservationDraft";
import { toDateKey } from "@/src/services/availabilityService";
import { submitBookingWithDateGuard } from "@/src/services/inventoryService";

export interface SubmitBookingResult {
  bookingId: string;
  bookingNumber?: string;
}

function validateReservationDetails(draft: ReservationDraft): void {
  if (!draft.startDate || !draft.endDate || !draft.fulfillmentMethod) {
    throw new Error("Missing rental details.");
  }

  if (
    draft.fulfillmentMethod === "delivery" &&
    (!draft.customerLocation.trim() || !draft.cityMunicipality.trim() || !draft.province.trim())
  ) {
    throw new Error("Please provide a complete delivery address (street/barangay, city/municipality, and province).");
  }

  const { customerInfo } = draft;
  if (
    !customerInfo.fullName.trim() ||
    !customerInfo.email.trim() ||
    !customerInfo.phone.trim() ||
    !customerInfo.streetBarangay.trim() ||
    !customerInfo.cityMunicipality.trim() ||
    !customerInfo.province.trim() ||
    !customerInfo.facebookLink.trim() ||
    !customerInfo.instagramLink.trim()
  ) {
    throw new Error("Missing required customer information.");
  }
}

export async function createBookingReservation(
  supabase: SupabaseClient<Database>,
  product: Product,
  draft: ReservationDraft,
): Promise<SubmitBookingResult> {
  validateReservationDetails(draft);
  const { customerInfo } = draft;
  const startDate = draft.startDate!;
  const endDate = draft.endDate!;
  const fulfillmentMethod = draft.fulfillmentMethod!;
  const rentalDays = getDayCount(startDate, endDate);
  const discountAmount = Math.round(
    product.dailyRate * rentalDays * draft.quantity * (product.discountPercent / 100) * 100,
  ) / 100;

  const result = await submitBookingWithDateGuard(supabase, {
    productId: product.id,
    quantity: draft.quantity,
    rentalStartDate: toDateKey(startDate),
    rentalEndDate: toDateKey(endDate),
    fulfillmentMethod,
    // Pickup never carries a delivery address (create_booking stores null for
    // pickup regardless), so only send it through for delivery bookings.
    location: fulfillmentMethod === "delivery" ? draft.customerLocation.trim() : undefined,
    cityMunicipality: fulfillmentMethod === "delivery" ? draft.cityMunicipality.trim() : undefined,
    province: fulfillmentMethod === "delivery" ? draft.province.trim() : undefined,
    discountAmount,
    productSnapshot: {
      name: product.name,
      brand: product.brand ?? "",
      category: product.category,
      image: product.images[0]?.url || "/images/product-placeholder.png",
      pricePerDay: product.pricePerDay,
      currency: product.currency,
      included: product.included,
    },
    customerSnapshot: {
      fullName: customerInfo.fullName.trim(),
      email: customerInfo.email.trim(),
      phone: customerInfo.phone.trim(),
      address: formatCustomerAddress(customerInfo),
      facebookLink: customerInfo.facebookLink.trim(),
      instagramLink: customerInfo.instagramLink.trim(),
    },
  });

  return { bookingId: result.bookingId, bookingNumber: result.bookingRef };
}

function extensionFromContentType(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function dataUrlToBlob(dataUrl: string): Blob {
  const separatorIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || separatorIndex < 0) {
    throw new Error("The electronic signature is invalid. Please sign again.");
  }

  const header = dataUrl.slice(5, separatorIndex);
  const encoded = dataUrl.slice(separatorIndex + 1);
  const isBase64 = header.endsWith(";base64");
  const contentType = header.replace(/;base64$/, "") || "image/png";

  try {
    if (isBase64) {
      const binary = window.atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new Blob([bytes], { type: contentType });
    }
    return new Blob([decodeURIComponent(encoded)], { type: contentType });
  } catch {
    throw new Error("The electronic signature is invalid. Please sign again.");
  }
}

export async function submitBookingDocuments(bookingId: string, draft: ReservationDraft): Promise<void> {
  // The reservation was already validated and persisted before checkout.
  // After PayMongo redirects back, the client rebuilds the draft from that
  // authoritative booking. Do not revalidate rental/address fields here:
  // legacy bookings may not have every newer structured address field, and
  // document submission only owns the requirements and agreement data below.
  const { requirements } = draft;
  if (
    !requirements.idOneFile ||
    !requirements.idTwoFile ||
    !requirements.selfieFile ||
    !requirements.facebookLink.trim() ||
    !requirements.instagramLink.trim() ||
    !requirements.emergencyContact.fullName.trim() ||
    !requirements.emergencyContact.relationship.trim() ||
    !requirements.emergencyContact.phone.trim() ||
    !requirements.emergencyContact.facebookLink.trim() ||
    !requirements.emergencyContact.idFile
  ) {
    throw new Error("Missing required rental information or documents.");
  }

  const { agreement } = draft;
  if (
    !agreement.infoAccurate ||
    !agreement.agreedToTerms ||
    !agreement.understoodRentalRules ||
    !agreement.authorizedESignature ||
    !agreement.readPrivacyNotice ||
    !agreement.emergencyContactAuthorized ||
    !agreement.typedFullName.trim() ||
    !agreement.signatureDataUrl
  ) {
    throw new Error("Complete and sign the rental agreement before submitting.");
  }

  const signatureBlob = dataUrlToBlob(agreement.signatureDataUrl);
  const signatureFile = new File(
    [signatureBlob],
    `signature.${extensionFromContentType(signatureBlob.type)}`,
    { type: signatureBlob.type || "image/png" },
  );
  const submissionId = crypto.randomUUID();

  async function uploadDocument(
    kind: "idOne" | "idTwo" | "selfie" | "emergencyId" | "signature",
    file: File,
    label: string,
  ): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    let response: Response;
    try {
      response = await fetch(
        `/api/bookings/${encodeURIComponent(bookingId)}/documents/upload` +
          `?kind=${encodeURIComponent(kind)}&submissionId=${encodeURIComponent(submissionId)}`,
        { method: "POST", credentials: "same-origin", body: formData },
      );
    } catch {
      throw new Error(`${label} could not reach the upload server. Check your connection and try again.`);
    }
    const body = (await response.json().catch(() => null)) as { path?: unknown; error?: unknown } | null;
    if (!response.ok || typeof body?.path !== "string") {
      throw new Error(typeof body?.error === "string" ? body.error : `${label} could not be uploaded.`);
    }
    return body.path;
  }

  const uploadedFiles = {
    idOne: await uploadDocument("idOne", requirements.idOneFile, "First valid ID"),
    idTwo: await uploadDocument("idTwo", requirements.idTwoFile, "Second valid ID"),
    selfie: await uploadDocument("selfie", requirements.selfieFile, "Selfie with ID"),
    emergencyId: await uploadDocument("emergencyId", requirements.emergencyContact.idFile, "Emergency contact ID"),
    signature: await uploadDocument("signature", signatureFile, "Electronic signature"),
  };

  const submitResponse = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/documents/submit`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      submissionId,
      files: uploadedFiles,
      facebookLink: requirements.facebookLink.trim(),
      instagramLink: requirements.instagramLink.trim(),
      emergencyContact: {
        fullName: requirements.emergencyContact.fullName.trim(),
        relationship: requirements.emergencyContact.relationship.trim(),
        phone: requirements.emergencyContact.phone.trim(),
        facebookLink: requirements.emergencyContact.facebookLink.trim(),
      },
      acknowledgements: {
        infoAccurate: agreement.infoAccurate,
        agreedToTerms: agreement.agreedToTerms,
        understoodRentalRules: agreement.understoodRentalRules,
        authorizedESignature: agreement.authorizedESignature,
        readPrivacyNotice: agreement.readPrivacyNotice,
        emergencyContactAuthorized: agreement.emergencyContactAuthorized,
      },
      signatureMethod: agreement.signatureMethod,
      typedFullName: agreement.typedFullName.trim(),
    }),
  });
  if (!submitResponse.ok) {
    const body = (await submitResponse.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof body?.error === "string" ? body.error : "The documents could not be securely submitted.");
  }

  const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/documents/agreement`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    console.warn("Documents were submitted, but the signed agreement PDF is still being prepared.");
  }
}

export async function submitBooking(
  supabase: SupabaseClient<Database>,
  product: Product,
  draft: ReservationDraft,
): Promise<SubmitBookingResult> {
  const reservation = await createBookingReservation(supabase, product, draft);
  await submitBookingDocuments(reservation.bookingId, draft);
  return reservation;
}

export { getDayCount };
