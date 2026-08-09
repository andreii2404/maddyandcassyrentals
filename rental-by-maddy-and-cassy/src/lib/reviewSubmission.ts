export interface SubmitReviewResult {
  reviewId: string | null;
  alreadySubmitted: boolean;
}

export function isDuplicateReviewError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || error.message?.includes("reviews_booking_item_id_key") === true;
}
