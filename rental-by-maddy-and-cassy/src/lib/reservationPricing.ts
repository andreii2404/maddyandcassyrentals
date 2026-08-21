import type { Product } from "@/types/product";
import type { ReservationDraft } from "@/src/types/reservationDraft";
import { getDayCount } from "@/src/types/reservationDraft";
import { calculatePerkDiscounts, type RewardProgress } from "@/src/lib/promotions";

export interface ReservationLinePricing {
  productId: string;
  productName: string;
  pricePerDay: number;
  quantity: number;
  rentalDays: number;
  /** quantity * rentalDays * product.listPricePerDay -- undiscounted. */
  lineListTotal: number;
  /** quantity * rentalDays * product.pricePerDay -- after catalog discount. */
  lineTotal: number;
}

export interface ReservationPricing {
  quantity: number;
  rentalDays: number;
  listSubtotal: number;
  productSubtotal: number;
  catalogDiscountAmount: number;
  birthdayDiscountAmount: number;
  loyaltyDiscountAmount: number;
  specialDiscountAmount: number;
  discountAmount: number;
  rentalSubtotal: number;
  depositAmount: number;
  fees: number;
  finalAmount: number;
}

export interface MultiItemReservationPricing extends ReservationPricing {
  lines: ReservationLinePricing[];
  /** Number of distinct products/lines. */
  productCount: number;
  /** Sum of every line's quantity -- total physical units across all products. */
  totalUnits: number;
}

function currency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Shared pricing math for both the single-product reserve flow and the cart's
 * combined checkout: sum every line's subtotal, then apply the account-level
 * birthday/loyalty perks once against the aggregate -- mirrors exactly what
 * the create_multi_item_booking / create_time_based_booking RPCs compute
 * server-side, so client-shown and server-persisted totals always agree.
 */
export function calculateMultiItemReservationPricing(
  lines: { product: Pick<Product, "id" | "name" | "listPricePerDay" | "pricePerDay" | "refundableDeposit">; quantity: number }[],
  draft: Pick<ReservationDraft, "startDate" | "endDate"> & {
    pickupConvenienceFee?: number;
    customerInfo: Pick<ReservationDraft["customerInfo"], "birthDate">;
  },
  rewardProgress: RewardProgress = { completedRentals: 0, loyaltyRewardUsed: false },
  isGuest = false,
): MultiItemReservationPricing {
  const rentalDays = getDayCount(draft.startDate, draft.endDate);

  const linePricing: ReservationLinePricing[] = lines.map(({ product, quantity }) => {
    const normalizedQuantity = Math.max(1, Math.floor(quantity || 1));
    return {
      productId: product.id,
      productName: product.name,
      pricePerDay: product.pricePerDay,
      quantity: normalizedQuantity,
      rentalDays,
      lineListTotal: currency(product.listPricePerDay * rentalDays * normalizedQuantity),
      lineTotal: currency(product.pricePerDay * rentalDays * normalizedQuantity),
    };
  });

  const listSubtotal = currency(linePricing.reduce((sum, line) => sum + line.lineListTotal, 0));
  const productSubtotal = currency(linePricing.reduce((sum, line) => sum + line.lineTotal, 0));
  const catalogDiscountAmount = currency(Math.max(0, listSubtotal - productSubtotal));

  // Birthday Month Discount and loyalty rewards are account-based perks --
  // guest checkout never qualifies, regardless of what the draft carries.
  const perks = calculatePerkDiscounts({
    rentalSubtotal: productSubtotal,
    birthDate: isGuest ? undefined : draft.customerInfo.birthDate,
    startDate: draft.startDate,
    endDate: draft.endDate,
    completedRentals: isGuest ? 0 : rewardProgress.completedRentals,
    loyaltyRewardUsed: isGuest ? true : rewardProgress.loyaltyRewardUsed,
  });
  const birthdayDiscountAmount = currency(perks.birthdayDiscountAmount);
  const loyaltyDiscountAmount = currency(perks.loyaltyDiscountAmount);
  const specialDiscountAmount = currency(perks.total);
  const discountAmount = currency(catalogDiscountAmount + specialDiscountAmount);
  const rentalSubtotal = currency(Math.max(0, productSubtotal - specialDiscountAmount));
  const depositAmount = currency(
    lines.reduce((sum, { product, quantity }) => sum + product.refundableDeposit * Math.max(1, Math.floor(quantity || 1)), 0),
  );
  const fees = currency(Math.max(0, draft.pickupConvenienceFee || 0));
  const finalAmount = currency(rentalSubtotal + depositAmount + fees);

  const totalUnits = linePricing.reduce((sum, line) => sum + line.quantity, 0);

  return {
    lines: linePricing,
    productCount: linePricing.length,
    totalUnits,
    quantity: totalUnits,
    rentalDays,
    listSubtotal,
    productSubtotal,
    catalogDiscountAmount,
    birthdayDiscountAmount,
    loyaltyDiscountAmount,
    specialDiscountAmount,
    discountAmount,
    rentalSubtotal,
    depositAmount,
    fees,
    finalAmount,
  };
}

export function calculateReservationPricing(
  product: Pick<Product, "id" | "name" | "listPricePerDay" | "pricePerDay" | "refundableDeposit">,
  draft: Pick<ReservationDraft, "quantity" | "startDate" | "endDate"> & {
    pickupConvenienceFee?: number;
    customerInfo: Pick<ReservationDraft["customerInfo"], "birthDate">;
  },
  rewardProgress: RewardProgress = { completedRentals: 0, loyaltyRewardUsed: false },
  isGuest = false,
): ReservationPricing {
  const multiItem = calculateMultiItemReservationPricing(
    [{ product, quantity: draft.quantity }],
    draft,
    rewardProgress,
    isGuest,
  );
  return {
    quantity: multiItem.lines[0].quantity,
    rentalDays: multiItem.rentalDays,
    listSubtotal: multiItem.listSubtotal,
    productSubtotal: multiItem.productSubtotal,
    catalogDiscountAmount: multiItem.catalogDiscountAmount,
    birthdayDiscountAmount: multiItem.birthdayDiscountAmount,
    loyaltyDiscountAmount: multiItem.loyaltyDiscountAmount,
    specialDiscountAmount: multiItem.specialDiscountAmount,
    discountAmount: multiItem.discountAmount,
    rentalSubtotal: multiItem.rentalSubtotal,
    depositAmount: multiItem.depositAmount,
    fees: multiItem.fees,
    finalAmount: multiItem.finalAmount,
  };
}
