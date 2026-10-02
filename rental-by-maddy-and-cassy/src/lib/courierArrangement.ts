/**
 * Customer-arranged courier for delivery bookings. The business never books or
 * charges for the courier: the customer books it and pays the courier directly,
 * so courier/delivery fees are never part of the rental payment or website
 * total. The chosen courier is saved on booking_fulfillments so admins can see
 * it (see migration 20261002140000_customer_arranged_courier.sql, whose checks
 * mirror the rules below).
 */

export const COURIER_OPTIONS = [
  { value: "lalamove", label: "Lalamove" },
  { value: "grab", label: "Grab" },
  { value: "angkas", label: "Angkas" },
  { value: "other", label: "Other" },
] as const;

export type CourierOption = (typeof COURIER_OPTIONS)[number]["value"];

/** How a delivery customer sends the rental back: by a courier they book, or in person. */
export type ReturnMethod = "courier" | "dropoff";

export const COURIER_NAME_MAX_LENGTH = 60;

export const COURIER_RESPONSIBILITY_NOTE =
  "Courier booking and payment will be handled by the customer. Delivery fees are separate from the rental fee.";

export interface CourierArrangement {
  deliveryCourier: CourierOption | null;
  /** Courier name, only when deliveryCourier is "other". */
  deliveryCourierOther: string;
  returnMethod: ReturnMethod | null;
  /** Only when returnMethod is "courier". */
  returnCourier: CourierOption | null;
  /** Courier name, only when returnCourier is "other". */
  returnCourierOther: string;
}

export const EMPTY_COURIER_ARRANGEMENT: CourierArrangement = {
  deliveryCourier: null,
  deliveryCourierOther: "",
  returnMethod: null,
  returnCourier: null,
  returnCourierOther: "",
};

export function isCourierOption(value: unknown): value is CourierOption {
  return COURIER_OPTIONS.some((option) => option.value === value);
}

export function isReturnMethod(value: unknown): value is ReturnMethod {
  return value === "courier" || value === "dropoff";
}

/** "Lalamove", or the typed name for "Other" (e.g. "Other — Mr. Speedy"). Empty when nothing is chosen. */
export function formatCourier(courier: CourierOption | null | undefined, otherName?: string | null): string {
  if (!courier) return "";
  if (courier === "other") {
    const name = (otherName ?? "").trim();
    return name ? `Other — ${name}` : "Other";
  }
  return COURIER_OPTIONS.find((option) => option.value === courier)?.label ?? "";
}

/** Human-readable return arrangement, or "" when nothing is chosen. */
export function formatReturnArrangement(
  arrangement: Pick<CourierArrangement, "returnMethod" | "returnCourier" | "returnCourierOther">,
): string {
  if (arrangement.returnMethod === "dropoff") return "Return in person (Sta. Cruz, Manila)";
  if (arrangement.returnMethod === "courier") {
    const courier = formatCourier(arrangement.returnCourier, arrangement.returnCourierOther);
    return courier ? `Courier — ${courier}` : "Courier";
  }
  return "";
}

function courierNameIssue(courier: CourierOption | null, otherName: string, leg: "delivery" | "return"): string | null {
  if (!courier) {
    return leg === "delivery" ? "Choose the courier for your delivery." : "Choose the courier for your return.";
  }
  if (courier === "other") {
    const name = otherName.trim();
    if (!name) {
      return leg === "delivery" ? "Enter the name of your delivery courier." : "Enter the name of your return courier.";
    }
    if (name.length > COURIER_NAME_MAX_LENGTH) {
      return `Keep the courier name to ${COURIER_NAME_MAX_LENGTH} characters or fewer.`;
    }
  }
  return null;
}

/** Everything still missing from a delivery booking's courier arrangement, in form order. */
export function getCourierArrangementIssues(arrangement: CourierArrangement): string[] {
  const issues: string[] = [];
  const deliveryIssue = courierNameIssue(arrangement.deliveryCourier, arrangement.deliveryCourierOther, "delivery");
  if (deliveryIssue) issues.push(deliveryIssue);
  if (!arrangement.returnMethod) {
    issues.push("Choose how you will return the rental.");
  } else if (arrangement.returnMethod === "courier") {
    const returnIssue = courierNameIssue(arrangement.returnCourier, arrangement.returnCourierOther, "return");
    if (returnIssue) issues.push(returnIssue);
  }
  return issues;
}

/** Trims names and drops fields that don't apply (e.g. a courier name when "Other" isn't chosen). */
export function normalizeCourierArrangement(arrangement: CourierArrangement): CourierArrangement {
  const returnsByCourier = arrangement.returnMethod === "courier";
  return {
    deliveryCourier: arrangement.deliveryCourier,
    deliveryCourierOther: arrangement.deliveryCourier === "other" ? arrangement.deliveryCourierOther.trim() : "",
    returnMethod: arrangement.returnMethod,
    returnCourier: returnsByCourier ? arrangement.returnCourier : null,
    returnCourierOther:
      returnsByCourier && arrangement.returnCourier === "other" ? arrangement.returnCourierOther.trim() : "",
  };
}

/** The p_courier payload the courier-aware booking RPCs expect. */
export function toCourierPayload(arrangement: CourierArrangement) {
  const normalized = normalizeCourierArrangement(arrangement);
  return {
    deliveryCourier: normalized.deliveryCourier,
    deliveryCourierOther: normalized.deliveryCourierOther || null,
    returnMethod: normalized.returnMethod,
    returnCourier: normalized.returnCourier,
    returnCourierOther: normalized.returnCourierOther || null,
  };
}

/** Reads the courier columns of a booking_fulfillments row, ignoring unknown values. */
export function courierArrangementFromRow(row: {
  delivery_courier?: string | null;
  delivery_courier_other?: string | null;
  return_method?: string | null;
  return_courier?: string | null;
  return_courier_other?: string | null;
} | null | undefined): CourierArrangement {
  if (!row) return { ...EMPTY_COURIER_ARRANGEMENT };
  return {
    deliveryCourier: isCourierOption(row.delivery_courier) ? row.delivery_courier : null,
    deliveryCourierOther: row.delivery_courier_other ?? "",
    returnMethod: isReturnMethod(row.return_method) ? row.return_method : null,
    returnCourier: isCourierOption(row.return_courier) ? row.return_courier : null,
    returnCourierOther: row.return_courier_other ?? "",
  };
}

const COURIER_NOTE_PREFIX = "Courier arrangement:";

/**
 * One-line summary kept in customer notes only when the database has not been
 * migrated yet (the courier-aware RPCs are missing), so admins still see the
 * customer's choice.
 */
export function courierNoteLine(arrangement: CourierArrangement): string {
  const delivery = formatCourier(arrangement.deliveryCourier, arrangement.deliveryCourierOther) || "not chosen";
  const returning = formatReturnArrangement(arrangement) || "not chosen";
  return `${COURIER_NOTE_PREFIX} delivery via ${delivery}; return: ${returning}. Booked and paid by the customer.`;
}

/** Replaces any earlier courier line in `notes` with the current one. */
export function withCourierNote(notes: string | undefined, arrangement: CourierArrangement): string {
  const kept = (notes ?? "")
    .split("\n")
    .filter((line) => !line.startsWith(COURIER_NOTE_PREFIX))
    .join("\n")
    .trim();
  return [kept, courierNoteLine(arrangement)].filter(Boolean).join("\n");
}

/** Customer-facing text for the courier validation errors raised by private.apply_customer_courier(). */
export function courierErrorMessage(message: string): string | null {
  if (message.includes("DELIVERY_COURIER_REQUIRED")) {
    return "Choose the courier for your delivery (Lalamove, Grab, Angkas, or Other with its name).";
  }
  if (message.includes("RETURN_ARRANGEMENT_REQUIRED")) {
    return "Choose how you will return the rental.";
  }
  if (message.includes("RETURN_COURIER_REQUIRED")) {
    return "Choose the courier for your return (Lalamove, Grab, Angkas, or Other with its name).";
  }
  if (message.includes("COURIER_NAME_TOO_LONG")) {
    return `Keep the courier name to ${COURIER_NAME_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

/** True when PostgREST reports that an RPC does not exist (the migration adding it is not applied yet). */
export function isMissingRpcError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "");
}
