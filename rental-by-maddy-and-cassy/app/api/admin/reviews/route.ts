import { NextResponse } from "next/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import {
  enforceRateLimit,
  requireActiveAdmin,
  RequestSecurityError,
} from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReviewQueryRow = {
  id: string;
  rating: number;
  comment: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
  moderated_at: string | null;
  moderated_by: string | null;
  booking_items: {
    booking_id: string;
    product_id: string;
    product_name_snapshot: string;
    products: { name: string } | null;
    bookings: {
      booking_reference: string;
      customer_id: string;
      status: string;
    } | null;
  } | null;
};

export async function GET(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-reviews-read", 90, 60_000);
    await requireActiveAdmin();

    // The service client is used only after the caller has independently
    // passed the active-admin check. This keeps customer identity data out of
    // browser-side Supabase queries and avoids broadening public RLS policies.
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("reviews")
      .select(`
        id,
        rating,
        comment,
        status,
        created_at,
        updated_at,
        moderated_at,
        moderated_by,
        booking_items(
          booking_id,
          product_id,
          product_name_snapshot,
          products(name),
          bookings(booking_reference, customer_id, status)
        )
      `)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as ReviewQueryRow[];
    const profileIds = Array.from(new Set(rows.flatMap((review) => {
      const ids = [review.booking_items?.bookings?.customer_id, review.moderated_by];
      return ids.filter((id): id is string => Boolean(id));
    })));

    const { data: profiles, error: profilesError } = profileIds.length
      ? await admin
          .from("profiles")
          .select("id, display_name, contact_email")
          .in("id", profileIds)
      : { data: [], error: null };

    if (profilesError) throw new Error(profilesError.message);
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

    const reviews = rows.map((review) => {
      const item = review.booking_items;
      const booking = item?.bookings;
      const customer = booking?.customer_id ? profileById.get(booking.customer_id) : null;
      const moderator = review.moderated_by ? profileById.get(review.moderated_by) : null;

      return {
        id: review.id,
        productId: item?.product_id ?? "",
        productName: item?.products?.name ?? item?.product_name_snapshot ?? "Rental item",
        rating: review.rating,
        comment: review.comment,
        status: review.status,
        createdAt: review.created_at,
        updatedAt: review.updated_at,
        moderatedAt: review.moderated_at,
        moderatorName: moderator?.display_name ?? null,
        bookingId: item?.booking_id ?? "",
        bookingRef: booking?.booking_reference ?? "Unknown booking",
        bookingStatus: booking?.status ?? "returned",
        customerId: booking?.customer_id ?? "",
        customerName: customer?.display_name ?? "Customer",
        customerEmail: customer?.contact_email ?? null,
      };
    });

    return NextResponse.json({ reviews });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin reviews read failed", error);
    return NextResponse.json(
      { error: "Customer feedback could not be loaded." },
      { status: 500 },
    );
  }
}
