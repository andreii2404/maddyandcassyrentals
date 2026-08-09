export const BIRTHDAY_MONTH_DISCOUNT = 100;
export const LOYALTY_REWARD_DISCOUNT = 200;
export const LOYALTY_REWARD_RENTAL_NUMBER = 11;
export const COMPLETED_RENTALS_BEFORE_REWARD = LOYALTY_REWARD_RENTAL_NUMBER - 1;

export interface RewardProgress {
  completedRentals: number;
  loyaltyRewardUsed: boolean;
  activeRewardBookingRef?: string;
}

export interface PerkDiscounts {
  birthdayEligible: boolean;
  loyaltyEligible: boolean;
  birthdayDiscountAmount: number;
  loyaltyDiscountAmount: number;
  total: number;
}

function dateOnly(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function rentalOverlapsBirthMonth(
  birthDate: string | null | undefined,
  startDate: Date | null,
  endDate: Date | null,
): boolean {
  const birth = dateOnly(birthDate);
  if (!birth || !startDate || !endDate) return false;

  const targetMonth = birth.getMonth();
  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(endDate);
  last.setHours(0, 0, 0, 0);

  while (cursor <= last) {
    if (cursor.getMonth() === targetMonth) return true;
    cursor.setDate(cursor.getDate() + 1);
  }
  return false;
}

export function calculatePerkDiscounts(input: {
  rentalSubtotal: number;
  birthDate?: string;
  startDate: Date | null;
  endDate: Date | null;
  completedRentals?: number;
  loyaltyRewardUsed?: boolean;
}): PerkDiscounts {
  const subtotal = Math.max(0, input.rentalSubtotal);
  const birthdayEligible = rentalOverlapsBirthMonth(
    input.birthDate,
    input.startDate,
    input.endDate,
  );
  const loyaltyEligible =
    (input.completedRentals ?? 0) >= COMPLETED_RENTALS_BEFORE_REWARD &&
    input.loyaltyRewardUsed !== true;

  const birthdayDiscountAmount = birthdayEligible
    ? Math.min(BIRTHDAY_MONTH_DISCOUNT, subtotal)
    : 0;
  const loyaltyDiscountAmount = loyaltyEligible
    ? Math.min(LOYALTY_REWARD_DISCOUNT, Math.max(0, subtotal - birthdayDiscountAmount))
    : 0;

  return {
    birthdayEligible,
    loyaltyEligible,
    birthdayDiscountAmount,
    loyaltyDiscountAmount,
    total: birthdayDiscountAmount + loyaltyDiscountAmount,
  };
}
