export function shouldShowPaymentSubmission(step: number, showPaymentHandoff: boolean): boolean {
  return step === 3 && !showPaymentHandoff;
}

export function shouldShowPaymentHandoff(
  bookingId: string | null,
  paymentState: "unpaid" | "pending" | "partially_paid" | "paid",
): boolean {
  return Boolean(bookingId) && paymentState !== "unpaid";
}
