import {
  COMPLETED_RENTALS_BEFORE_REWARD,
  LOYALTY_REWARD_DISCOUNT,
  LOYALTY_REWARD_RENTAL_NUMBER,
} from "@/src/lib/promotions";

export type LoyaltyEmailOutcome =
  | { kind: "none" }
  | { kind: "progress"; completedRentals: number; rentalsUntilReward: number }
  | { kind: "reward_unlocked" }
  | { kind: "reward_available" }
  | { kind: "reward_applied"; discountAmount: number };

/**
 * What the Rental Completed email should say about loyalty. It only reads the existing rule
 * (10 completed rentals unlock one reward for the 11th) and writes nothing: the count comes from
 * bookings already marked completed, so retrying a completion can never award anything twice.
 * `completedRentals` must already include the rental that was just completed.
 */
export function getLoyaltyEmailOutcome(input: {
  isGuest: boolean;
  completedRentals: number;
  loyaltyRewardUsed: boolean;
  /** Loyalty discount this booking itself received (0 when it did not use the reward). */
  thisBookingRewardAmount: number;
}): LoyaltyEmailOutcome {
  if (input.isGuest) return { kind: "none" };
  if (input.thisBookingRewardAmount > 0) {
    return { kind: "reward_applied", discountAmount: input.thisBookingRewardAmount };
  }
  if (input.loyaltyRewardUsed) return { kind: "none" };
  if (input.completedRentals > COMPLETED_RENTALS_BEFORE_REWARD) return { kind: "reward_available" };
  if (input.completedRentals === COMPLETED_RENTALS_BEFORE_REWARD) return { kind: "reward_unlocked" };
  if (input.completedRentals < 1) return { kind: "none" };
  return {
    kind: "progress",
    completedRentals: input.completedRentals,
    rentalsUntilReward: COMPLETED_RENTALS_BEFORE_REWARD - input.completedRentals,
  };
}

const peso = (value: number) => `₱${value.toLocaleString("en-PH")}`;

/** Customer-friendly sentence for the email, or null when there is nothing to say. */
export function describeLoyaltyOutcome(outcome: LoyaltyEmailOutcome): string | null {
  switch (outcome.kind) {
    case "none":
      return null;
    case "progress": {
      const remaining = outcome.rentalsUntilReward;
      return `You have completed ${outcome.completedRentals} of ${COMPLETED_RENTALS_BEFORE_REWARD} rentals. ${remaining} more rental${remaining === 1 ? "" : "s"} to go before your ${peso(LOYALTY_REWARD_DISCOUNT)} loyalty reward on rental number ${LOYALTY_REWARD_RENTAL_NUMBER}.`;
    }
    case "reward_unlocked":
      return `Congratulations! You have unlocked a ${peso(LOYALTY_REWARD_DISCOUNT)} loyalty reward. It will be applied automatically to your next booking.`;
    case "reward_available":
      return `Your ${peso(LOYALTY_REWARD_DISCOUNT)} loyalty reward is still waiting. It will be applied automatically to your next booking.`;
    case "reward_applied":
      return `Your ${peso(outcome.discountAmount)} loyalty reward was applied to this rental. Thank you for being a loyal renter!`;
  }
}
