import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reviewId: string }> },
): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-review-moderation", 60, 60_000);
    const { user } = await requireActiveAdmin();
    const admin = createAdminClient();
    const { reviewId } = await params;
    const body = (await request.json()) as { status?: unknown };
    if (body.status !== "approved" && body.status !== "rejected") {
      return NextResponse.json({ error: "Choose approve or reject." }, { status: 400 });
    }

    const { data: review, error: reviewError } = await admin
      .from("reviews")
      .select("id, status")
      .eq("id", reviewId)
      .maybeSingle();
    if (reviewError) throw new Error(reviewError.message);
    if (!review) return NextResponse.json({ error: "The review no longer exists." }, { status: 404 });

    const { error } = await admin
      .from("reviews")
      .update({ status: body.status, moderated_by: user.id, moderated_at: new Date().toISOString() })
      .eq("id", reviewId);
    if (error) throw new Error(error.message);

    await admin.rpc("log_audit_event", {
      p_action: "catalog.review_moderated",
      p_entity_type: "review",
      p_entity_id: reviewId,
      p_previous_values: { status: review.status },
      p_new_values: { status: body.status },
    });
    revalidatePath("/");
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Review moderation failed", error);
    return NextResponse.json({ error: "The review decision could not be saved." }, { status: 500 });
  }
}
