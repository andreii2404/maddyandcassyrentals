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
  "payment.receipt_emailed": "Receipt emailed",
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
  booking_receipt: "Official receipt",
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

/** Generic role label, e.g. "Administrator" or "Customer", with no name lookup involved. */
export function formatActorRole(actorType: AdminAuditLog["actorType"]): string {
  return ACTOR_LABELS[actorType] ?? sentenceCase(actorType);
}

/**
 * `actorNamesById` is an optional lookup (built from the profiles table) so the
 * page can show a real customer/admin name instead of just the generic role —
 * falls back to the role label when no name is known for that actor.
 */
export function formatAuditActor(
  log: Pick<AdminAuditLog, "actorType" | "actorUserId">,
  actorNamesById?: Map<string, string>,
): string {
  const name = log.actorUserId ? actorNamesById?.get(log.actorUserId) : undefined;
  if (name) return name;
  return formatActorRole(log.actorType);
}

export type ActivityCategory =
  | "booking"
  | "payment"
  | "documents"
  | "account"
  | "catalog"
  | "admin"
  | "other";

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  booking: "Booking",
  payment: "Payment",
  documents: "Documents",
  account: "Account",
  catalog: "Catalog",
  admin: "Admin",
  other: "Other",
};

/** Groups the free-form audit `action` strings into the badge categories shown on the Activity History page. */
export function getActivityCategory(action: string): ActivityCategory {
  if (action.startsWith("verification.") || action === "booking.documents_submitted") {
    return "documents";
  }
  if (action.startsWith("booking.")) return "booking";
  if (action.startsWith("payment.")) return "payment";
  if (action.startsWith("account.")) return "account";
  if (action.startsWith("catalog.") || action.startsWith("inventory.")) return "catalog";
  if (action.startsWith("admin.") || action.startsWith("agreement.")) return "admin";
  return "other";
}

export function formatActivityCategory(category: ActivityCategory): string {
  return CATEGORY_LABELS[category];
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

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Plain-language, admin-friendly explanation of an audit entry for the expanded
 * row on the Activity History page. Deliberately avoids raw IDs, JSON, or any
 * developer-facing field names — only what a non-technical admin needs to know.
 */
export function formatWhatHappened(log: AdminAuditLog, actorName: string): string {
  const metadata = log.metadata ?? {};
  const newValues = log.newValues ?? {};
  const reason = pickString(metadata.reason, metadata.declineReason, metadata.cancellationReason, newValues.reason);

  switch (log.action) {
    case "booking.created":
      return `${actorName} created a new booking.`;
    case "booking.multi_item_created": {
      const itemCount = metadata.itemCount;
      const items = typeof itemCount === "number" ? `${itemCount} item${itemCount === 1 ? "" : "s"}` : "a new booking";
      return `${actorName} created a booking with ${items}.`;
    }
    case "booking.confirmed":
      return `${actorName} confirmed this booking.`;
    case "booking.cancelled":
      return reason ? `${actorName} cancelled this booking. Reason: ${reason}` : `${actorName} cancelled this booking.`;
    case "booking.status_changed": {
      const status = typeof newValues.status === "string" ? sentenceCase(newValues.status) : undefined;
      const base = status
        ? `${actorName} changed the booking status to "${status}".`
        : `${actorName} updated the booking status.`;
      return reason ? `${base} Reason: ${reason}` : base;
    }
    case "booking.details_updated":
      return `${actorName} updated the booking details.`;
    case "booking.multi_day_period_applied":
      return `${actorName} applied a multi-day rental period to this booking.`;
    case "booking.documents_submitted":
      return `${actorName} submitted documents for this booking.`;
    case "payment.proof_submitted":
      return `${actorName} submitted proof of payment for this booking.`;
    case "payment.reviewed":
      return `${actorName} reviewed a payment submission.`;
    case "payment.verified":
      return `${actorName} verified a payment.`;
    case "payment.receipt_emailed":
      return `${actorName} emailed the official receipt to the customer.`;
    case "verification.document_reviewed":
      return `${actorName} reviewed a verification document.`;
    case "agreement.business_countersigned":
      return `${actorName} signed the rental agreement on behalf of the business.`;
    case "account.updated":
      return `${actorName} updated account information.`;
    case "account.deleted":
      return `${actorName} deleted an account.`;
    case "catalog.product_created":
      return `${actorName} added a new product to the catalog.`;
    case "catalog.product_updated":
      return `${actorName} updated a product's details.`;
    case "catalog.product_deactivated":
      return `${actorName} deactivated a product.`;
    case "catalog.price_changed": {
      const newPrice = typeof newValues.newPrice === "number" ? `₱${newValues.newPrice.toLocaleString("en-PH")}` : undefined;
      return newPrice
        ? `${actorName} changed the price to ${newPrice}.`
        : `${actorName} changed a product's price.`;
    }
    case "catalog.category_created":
      return `${actorName} added a new category.`;
    case "catalog.category_updated":
      return `${actorName} updated a category.`;
    case "catalog.category_deleted":
      return `${actorName} deleted a category.`;
    case "catalog.review_moderated":
      return `${actorName} moderated a customer review.`;
    case "inventory.unit_updated":
      return `${actorName} updated an inventory unit.`;
    case "admin.login":
      return `${actorName} signed in to the admin dashboard.`;
    default:
      return `${actorName} performed "${formatAuditAction(log.action)}".`;
  }
}
