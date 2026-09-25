// A resubmission request is stored as the existing "rejected" review decision
// on the latest booking_requirement_submissions row (and "rejected" on its
// booking_requirements row). Every verification gate — confirm_booking's
// DOCUMENTS_NOT_APPROVED check, the agreement route, and getApprovalBlockers —
// already refuses anything that is not approved/waived, so a requirement that
// is waiting for resubmission can never count as verified. The customer's
// replacement upload (documents/resubmit) inserts a new "pending" attempt,
// which is what puts the requirement back into Needs Review. Every attempt is
// kept, so the original upload, the request, and the replacement all remain.

import type { RequirementReviewStatus } from "@/src/types/booking";

export const WAITING_FOR_RESUBMISSION_LABEL = "Waiting for Resubmission";
export const NEEDS_REVIEW_LABEL = "Needs Review";
export const RESUBMISSION_REQUESTED_MESSAGE =
  "Resubmission requested. Please wait for the customer to submit the updated requirement.";

/** "government_id" -> "Government ID"; unknown keys fall back to title case. */
export function formatRequirementName(documentType: string): string {
  const words = documentType.replaceAll("_", " ").trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
  return words.replace(/\bId\b/g, "ID") || "Document";
}

/** Admin-facing label for a single document's latest review decision. */
export function adminRequirementReviewLabel(status: RequirementReviewStatus): string {
  if (status === "rejected") return WAITING_FOR_RESUBMISSION_LABEL;
  if (status === "approved") return "Approved";
  return NEEDS_REVIEW_LABEL;
}

/** Customer-account notification created when an admin requests a resubmission. */
export function buildResubmissionRequestNotification(input: {
  documentType: string;
  bookingRef?: string | null;
  reason: string;
}): { title: string; message: string } {
  const requirement = formatRequirementName(input.documentType);
  const bookingLabel = input.bookingRef ? ` for booking ${input.bookingRef}` : "";
  const reason = input.reason.trim();
  return {
    title: `Resubmission requested: ${requirement}`,
    message:
      `Please resubmit your ${requirement}${bookingLabel}.` +
      (reason ? ` Reason: ${reason}` : "") +
      " Open the booking's Documents section to upload the updated file.",
  };
}
