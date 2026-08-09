import type { Product } from "@/types/product";
import type { ReservationDraft } from "@/src/types/reservationDraft";
import { getDayCount } from "@/src/types/reservationDraft";
import { calculatePerkDiscounts, type RewardProgress } from "@/src/lib/promotions";

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

function currency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateReservationPricing(
  product: Pick<Product, "listPricePerDay" | "pricePerDay" | "refundableDeposit">,
  draft: Pick<ReservationDraft, "quantity" | "startDate" | "endDate"> & {
    customerInfo: Pick<ReservationDraft["customerInfo"], "birthDate">;
  },
  rewardProgress: RewardProgress = { completedRentals: 0, loyaltyRewardUsed: false },
): ReservationPricing {
  const quantity = Math.max(1, Math.floor(draft.quantity || 1));
  const rentalDays = getDayCount(draft.startDate, draft.endDate);
  const listSubtotal = currency(product.listPricePerDay * rentalDays * quantity);
  const productSubtotal = currency(product.pricePerDay * rentalDays * quantity);
  const catalogDiscountAmount = currency(Math.max(0, listSubtotal - productSubtotal));
  const perks = calculatePerkDiscounts({
    rentalSubtotal: productSubtotal,
    birthDate: draft.customerInfo.birthDate,
    startDate: draft.startDate,
    endDate: draft.endDate,
    completedRentals: rewardProgress.completedRentals,
    loyaltyRewardUsed: rewardProgress.loyaltyRewardUsed,
  });
  const birthdayDiscountAmount = currency(perks.birthdayDiscountAmount);
  const loyaltyDiscountAmount = currency(perks.loyaltyDiscountAmount);
  const specialDiscountAmount = currency(perks.total);
  const discountAmount = currency(catalogDiscountAmount + specialDiscountAmount);
  const rentalSubtotal = currency(Math.max(0, productSubtotal - specialDiscountAmount));
  const depositAmount = currency(product.refundableDeposit * quantity);
  const fees = 0;
  const finalAmount = currency(rentalSubtotal + depositAmount + fees);

  return {
    quantity,
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
