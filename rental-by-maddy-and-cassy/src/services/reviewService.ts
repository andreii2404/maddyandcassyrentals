import { createPublicClient } from "@/src/lib/supabase/public";
import type { Tables } from "@/src/lib/supabase/database.types";
import type { SubmitReviewResult } from "@/src/lib/reviewSubmission";
import type { Review } from "@/src/types/database";

// public.reviews no longer carries booking_id/product_id/user_id directly —
// it's keyed by booking_item_id, so those are resolved by joining through
// booking_items (product_id) and booking_items -> bookings (customer_id),
// mirroring the join private.get_product_reviews_internal() uses.

type ReviewRow = Pick<
  Tables<"reviews">,
  "id" | "comment" | "rating" | "status" | "created_at" | "moderated_at" | "moderated_by"
> & {
  booking_items:
    | (Pick<Tables<"booking_items">, "product_id" | "booking_id"> & {
        bookings: Pick<Tables<"bookings">, "customer_id"> | null;
      })
    | null;
};

function mapReview(row: ReviewRow): Review {
  return {
    id: row.id,
    bookingId: row.booking_items?.booking_id ?? "",
    productId: row.booking_items?.product_id ?? "",
    userId: row.booking_items?.bookings?.customer_id ?? "",
    rating: row.rating,
    comment: row.comment ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    moderatedAt: row.moderated_at ?? undefined,
    moderatedBy: row.moderated_by ?? undefined,
  };
}

/**
 * RLS (reviews_customer_insert_returned_booking) independently re-verifies
 * that the booking belongs to this customer, is for this product, and has
 * status 'returned' — this is only a convenience wrapper.
 */
export async function submitReview(
  input: {
    bookingId: string;
    productId: string;
    rating: number;
    comment?: string;
  },
): Promise<SubmitReviewResult> {
  const response = await fetch(`/api/bookings/${encodeURIComponent(input.bookingId)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productId: input.productId,
      rating: input.rating,
      comment: input.comment,
    }),
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    reviewId?: string | null;
    alreadySubmitted?: boolean;
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error || "We couldn't send your review right now. Please try again.");
  }
  return {
    reviewId: payload?.reviewId ?? null,
    alreadySubmitted: payload?.alreadySubmitted === true,
  };
}

export async function getApprovedReviewsForProduct(productId: string): Promise<Review[]> {
  const { data, error } = await createPublicClient()
    .from("reviews")
    .select(
      "id, comment, rating, status, created_at, moderated_at, moderated_by, booking_items!inner(product_id, booking_id, bookings(customer_id))",
    )
    .eq("booking_items.product_id", productId)
    .eq("status", "approved")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ReviewRow[]).map(mapReview);
}
