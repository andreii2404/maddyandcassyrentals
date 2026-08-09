import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  requireUser,
  RequestSecurityError,
} from "@/src/lib/server/requestSecurity";
import { isDuplicateReviewError } from "@/src/lib/reviewSubmission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    enforceRateLimit(request, "customer-review", 10, 60_000);
    const { supabase, user } = await requireUser();
    const { bookingId } = await params;
    const body = (await request.json().catch(() => null)) as {
      productId?: unknown;
      rating?: unknown;
      comment?: unknown;
    } | null;

    const productId = typeof body?.productId === "string" ? body.productId.trim() : "";
    const rating = typeof body?.rating === "number" ? body.rating : Number.NaN;
    const comment = typeof body?.comment === "string" ? body.comment.trim() : "";

    if (!bookingId || !productId) return errorResponse("This rental item could not be identified.", 400);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return errorResponse("Choose a rating from one to five stars.", 400);
    }
    if (comment.length > 1000) return errorResponse("Reviews must be 1,000 characters or fewer.", 400);

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, customer_id, status")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) return errorResponse("This booking could not be verified.", 503);
    if (!booking || booking.customer_id !== user.id) {
      return errorResponse("This booking is not available from your account.", 404);
    }
    if (booking.status !== "returned") {
      return errorResponse("A review can be sent after the rental has been completed and returned.", 409);
    }

    const { data: item, error: itemError } = await supabase
      .from("booking_items")
      .select("id")
      .eq("booking_id", bookingId)
      .eq("product_id", productId)
      .maybeSingle();

    if (itemError || !item) return errorResponse("This booking does not include the selected product.", 404);

    const { data: existingReview, error: existingError } = await supabase
      .from("reviews")
      .select("id")
      .eq("booking_item_id", item.id)
      .maybeSingle();

    if (existingError) return errorResponse("Your previous review could not be checked.", 503);
    if (existingReview) {
      return NextResponse.json({ reviewId: existingReview.id, alreadySubmitted: true });
    }

    const { data: review, error: reviewError } = await supabase
      .from("reviews")
      .insert({
        booking_item_id: item.id,
        rating,
        comment: comment || null,
        status: "pending",
      })
      .select("id")
      .single();

    // A second request can race the first one after the existing-review check.
    // The unique booking-item constraint remains the final source of truth.
    if (isDuplicateReviewError(reviewError)) {
      return NextResponse.json({ reviewId: null, alreadySubmitted: true });
    }
    if (reviewError || !review) {
      console.error("Customer review submission failed", reviewError);
      return errorResponse("We couldn't send your review right now. Please try again.", 500);
    }

    return NextResponse.json(
      { reviewId: review.id, alreadySubmitted: false },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Customer review submission failed", error);
    return errorResponse("We couldn't send your review right now. Please try again.", 500);
  }
}
