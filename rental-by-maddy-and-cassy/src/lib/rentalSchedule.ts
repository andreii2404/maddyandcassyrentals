import { differenceInCalendarDays, format, isSameDay } from "date-fns";
import type { ReservationDraft } from "@/src/types/reservationDraft";
import {
  calculateEstimatedDeliveryDateTime,
  calculateReturnDateTime,
  combineManilaPickupDateTime,
  isValidPickupTime,
  pickupDateKey,
} from "@/src/lib/rentalTiming";

export interface DraftRentalSchedule {
  /** Last selected calendar day of the rental (the start date for single-day rentals). */
  rentalEndDate: Date | null;
  rentalDays: number;
  /** Selected pickup/delivery handover timestamp, or null until both date and time are chosen. */
  pickupAt: Date | null;
  returnAt: Date | null;
  /** Selected time plus the minimum delivery transportation allowance; null unless delivery is chosen. */
  estimatedDeliveryAt: Date | null;
  datesLabel: string;
}

/**
 * Derives the live rental schedule from the reservation draft. Shared by the
 * Rental Details step and the checkout cart summary so both always show the
 * same dates and times.
 */
export function getDraftRentalSchedule(
  draft: Pick<ReservationDraft, "startDate" | "rentalEndDate" | "pickupTime" | "fulfillmentMethod">,
): DraftRentalSchedule {
  const rentalEndDate = draft.rentalEndDate ?? draft.startDate;
  const rentalDays = draft.startDate && rentalEndDate
    ? Math.max(1, differenceInCalendarDays(rentalEndDate, draft.startDate) + 1)
    : 1;

  let pickupAt: Date | null = null;
  if (draft.startDate && isValidPickupTime(draft.pickupTime)) {
    const value = combineManilaPickupDateTime(pickupDateKey(draft.startDate), draft.pickupTime);
    pickupAt = Number.isNaN(value.getTime()) ? null : value;
  }

  const returnAt = pickupAt ? calculateReturnDateTime(pickupAt, rentalDays) : null;
  const estimatedDeliveryAt =
    pickupAt && draft.fulfillmentMethod === "delivery"
      ? calculateEstimatedDeliveryDateTime(pickupAt)
      : null;

  const datesLabel =
    draft.startDate && rentalEndDate
      ? isSameDay(draft.startDate, rentalEndDate)
        ? format(draft.startDate, "EEE, MMM d, yyyy")
        : `${format(draft.startDate, "MMM d, yyyy")} – ${format(rentalEndDate, "MMM d, yyyy")}`
      : "Not selected yet";

  return { rentalEndDate, rentalDays, pickupAt, returnAt, estimatedDeliveryAt, datesLabel };
}
