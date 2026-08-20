import type { AgreementDoc, Booking } from "@/src/types/booking";
import type { BookingItemsSummaryItem } from "@/components/booking-summary/BookingItemsSummary";

/**
 * Short human label for a booking's product(s) -- a single-item booking
 * reads exactly like before ("Canon EOS R5"), a multi-item booking gets a
 * "+N more" suffix instead of silently showing only the first product.
 */
export function bookingHeadline(items: Pick<Booking["items"][number], "productName">[]): string {
  if (items.length === 0) return "Booking";
  if (items.length === 1) return items[0].productName;
  return `${items[0].productName} + ${items.length - 1} more item${items.length - 1 === 1 ? "" : "s"}`;
}

/**
 * Once the customer has signed, unit codes/serials must come from the frozen
 * agreement_versions.agreement_snapshot -- never from live inventory --
 * because that snapshot is exactly what the customer agreed to. Before an
 * agreement exists there is nothing frozen yet, so the item table renders
 * without a units column at all rather than reading live allocation state.
 */
export function bookingItemsSummaryData(
  booking: Booking,
  agreement: AgreementDoc | null,
): { items: BookingItemsSummaryItem[]; unitsExpected: boolean } {
  const snapshotItems = agreement?.agreementSnapshot?.items;
  if (snapshotItems?.length) {
    return {
      unitsExpected: true,
      items: snapshotItems.map((item) => ({
        productName: item.productName,
        brand: item.brand,
        pricePerDay: item.pricePerDay,
        quantity: item.quantity,
        rentalDays: item.rentalDays,
        lineTotal: item.lineTotal,
        includedAccessories: item.includedAccessories,
        units: item.units,
      })),
    };
  }

  return {
    unitsExpected: false,
    items: booking.items.map((item) => ({
      productName: item.productName,
      brand: item.brand,
      pricePerDay: item.dailyRate,
      quantity: item.quantity,
      rentalDays: booking.dayCount,
      lineTotal: item.lineRentalSubtotal,
      includedAccessories: item.included,
    })),
  };
}
