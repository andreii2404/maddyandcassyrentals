import type { AdminAuditLog } from "@/src/services/operationsService";

/**
 * Purely display-layer helpers for the admin Activity History page.
 * None of this touches stored audit data — it only reformats it for reading.
 */

const ACTION_LABELS: Record<string, string> = {
  "booking.created": "Booking created",
  "booking.multi_item_created": "Booking created",
  "booking.confirmed": "Booking confirmed",
  "booking.cancelled": "Booking cancelled",
  "booking.status_changed": "Booking status updated",
  "booking.details_updated": "Booking details updated",
  "booking.multi_day_period_applied": "Multi-day rental period applied",
  "booking.documents_submitted": "Documents submitted",
  "payment.proof_submitted": "Payment proof submitted",
  "payment.reviewed": "Payment reviewed",
  "payment.verified": "Payment verified",
  "verification.document_reviewed": "Verification document reviewed",
  "agreement.business_countersigned": "Rental agreement signed",
  "account.updated": "Account updated",
  "account.deleted": "Account deleted",
  "catalog.product_created": "Product added",
  "catalog.product_updated": "Product updated",
  "catalog.product_deactivated": "Product deactivated",
  "catalog.price_changed": "Price changed",
  "catalog.category_created": "Category added",
  "catalog.category_updated": "Category updated",
  "catalog.category_deleted": "Category deleted",
  "catalog.review_moderated": "Review moderated",
  "inventory.unit_updated": "Inventory unit updated",
  "admin.login": "Administrator signed in",
};

const ACTOR_LABELS: Record<string, string> = {
  system: "System",
  service: "Automated service",
  admin: "Administrator",
  user: "Customer",
};

const ENTITY_LABELS: Record<string, string> = {
  booking: "Booking",
  payment_submission: "Payment proof",
  booking_agreement: "Rental agreement",
  requirement_submission: "Verification document",
  product: "Product",
  category: "Category",
  inventory_unit: "Inventory unit",
  review: "Review",
  admin_session: "Admin session",
  user: "Customer account",
};

function sentenceCase(text: string): string {
  const spaced = text.replace(/[._]+/g, " ").trim();
  if (!spaced) return "Activity";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatAuditAction(action: string): string {
  return ACTION_LABELS[action] ?? sentenceCase(action);
}

export function formatAuditActor(log: Pick<AdminAuditLog, "actorType">): string {
  return ACTOR_LABELS[log.actorType] ?? sentenceCase(log.actorType);
}

function formatEntityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? sentenceCase(entityType);
}

/** Readable, non-identifying summary for the Details column. */
export function formatAuditDetails(log: AdminAuditLog): string {
  const metadata = log.metadata ?? {};
  const newValues = log.newValues ?? {};

  if (log.action === "booking.multi_item_created") {
    const itemCount = metadata.itemCount;
    if (typeof itemCount === "number") {
      return `${itemCount} item${itemCount === 1 ? "" : "s"} reserved`;
    }
  }

  if (log.action === "booking.status_changed" && typeof newValues.status === "string") {
    return `Status set to ${sentenceCase(newValues.status)}`;
  }

  if (log.action === "catalog.price_changed" && typeof newValues.newPrice === "number") {
    return `New rate ₱${newValues.newPrice.toLocaleString("en-PH")}`;
  }

  return formatEntityLabel(log.entityType);
}

/** Readable booking reference derived from the booking UUID (no raw UUID shown). */
export function formatBookingReference(bookingId: string): string {
  return `BK-${bookingId.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}
