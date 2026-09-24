export interface CheckoutAvailabilityItem {
  productId: string;
  quantity: number;
  variant?: string;
}

/** Stable identity for the exact availability request shown by checkout. */
export function createBatchAvailabilityRequestKey(
  items: CheckoutAvailabilityItem[],
  pickupAt: Date,
  rentalDays: number,
): string {
  return JSON.stringify([
    pickupAt.toISOString(),
    rentalDays,
    items.map(({ productId, quantity, variant }) => [productId, quantity, variant?.trim() ?? ""]),
  ]);
}
