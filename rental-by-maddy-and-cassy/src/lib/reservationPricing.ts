import type { Product } from "@/types/product";
import type { ReservationDraft } from "@/src/types/reservationDraft";
import { getDayCount } from "@/src/types/reservationDraft";

export interface ReservationPricing {
  quantity: number;
  rentalDays: number;
  listSubtotal: number;
  productSubtotal: number;
  discountAmount: number;
  depositAmount: number;
  fees: number;
  finalAmount: number;
}

function currency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateReservationPricing(
  product: Pick<Product, "listPricePerDay" | "pricePerDay" | "refundableDeposit">,
  draft: Pick<ReservationDraft, "quantity" | "startDate" | "endDate">,
): ReservationPricing {
  const quantity = Math.max(1, Math.floor(draft.quantity || 1));
  const rentalDays = getDayCount(draft.startDate, draft.endDate);
  const listSubtotal = currency(product.listPricePerDay * rentalDays * quantity);
  const productSubtotal = currency(product.pricePerDay * rentalDays * quantity);
  const discountAmount = currency(Math.max(0, listSubtotal - productSubtotal));
  const depositAmount = currency(product.refundableDeposit * quantity);
  const fees = 0;
  const finalAmount = currency(productSubtotal + depositAmount + fees);

  return {
    quantity,
    rentalDays,
    listSubtotal,
    productSubtotal,
    discountAmount,
    depositAmount,
    fees,
    finalAmount,
  };
}
