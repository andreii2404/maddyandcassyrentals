import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { getAllBookings } from "@/src/services/bookingService";
import { bookingHeadline } from "@/src/lib/bookingDisplay";

export const runtime = "nodejs";

const CLOSED_STATUSES = new Set(["returned", "cancelled", "rejected"]);

export async function GET(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-dashboard-read", 60, 60_000);
    const { supabase } = await requireActiveAdmin();

    const [{ count: customerAccounts }, { count: catalogProducts }, bookings, { data: payments }] =
      await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("products").select("*", { count: "exact", head: true }),
        getAllBookings(supabase),
        supabase.from("booking_payment_submissions").select("declared_amount, status"),
      ]);

    let activeBookings = 0;
    let completedRentals = 0;
    let pendingVerification = 0;
    const productBookingCounts = new Map<string, number>();

    for (const booking of bookings) {
      if (!CLOSED_STATUSES.has(booking.status)) activeBookings += 1;
      if (booking.status === "returned") completedRentals += 1;
      if (booking.requirementsStatus === "pending_review") pendingVerification += 1;
      for (const item of booking.items) {
        const productName = item.productName || "Rental item";
        productBookingCounts.set(productName, (productBookingCounts.get(productName) ?? 0) + 1);
      }
    }

    const paymentRows = payments ?? [];
    const verifiedPayments = paymentRows.filter((row) => row.status === "verified");
    const verifiedRevenue = verifiedPayments.reduce((sum, row) => sum + row.declared_amount, 0);
    // payment_submission_status has no "failed" value anymore — rejected/void are the closest equivalent.
    const failedPayments = paymentRows.filter((row) => row.status === "rejected" || row.status === "void").length;
    const popularProduct = [...productBookingCounts.entries()].sort((a, b) => b[1] - a[1])[0];

    return NextResponse.json({
      metrics: {
        customerAccounts: customerAccounts ?? 0,
        verifiedRevenue,
        successfulPayments: verifiedPayments.length,
        failedPayments,
        pendingVerification,
        activeBookings,
        catalogProducts: catalogProducts ?? 0,
        completedRentals,
        popularProductName: popularProduct?.[0] ?? null,
        popularProductBookings: popularProduct?.[1] ?? 0,
      },
      recentBookings: bookings.slice(0, 6).map((booking) => ({
        id: booking.id,
        bookingRef: booking.bookingRef,
        customerName: booking.customerSnapshot.fullName || "Customer",
        productName: bookingHeadline(booking.items),
        status: booking.status,
        createdAt: booking.createdAt,
      })),
    });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin dashboard read failed", error);
    return NextResponse.json({ error: "The dashboard data could not be loaded." }, { status: 500 });
  }
}
