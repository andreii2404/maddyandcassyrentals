import { NextResponse } from "next/server";
import { type EmailBookingStatus } from "@/src/lib/bookingStatusEmailContent";
import { sendBookingApprovalEmail } from "@/src/lib/server/bookingApprovalEmail";
import { sendBookingStatusEmail } from "@/src/lib/server/bookingStatusEmail";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import type { BookingStatus } from "@/src/types/booking";
import { bookingHeadline } from "@/src/lib/bookingDisplay";
import { bookingTrackingPath } from "@/src/lib/bookingAccess";
import { getApprovalBlockers } from "@/src/lib/bookingManagement";
import { getBookingById } from "@/src/services/bookingService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES: BookingStatus[] = ["pending", "approved", "confirmed", "ready_for_release", "released", "returned", "cancelled", "rejected"];
const NOTE_REQUIRED = new Set<BookingStatus>(["cancelled", "rejected"]);

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === "string" && (VALID_STATUSES as string[]).includes(value);
}

function isEmailBookingStatus(status: BookingStatus): status is EmailBookingStatus {
  return status === "approved" || status === "returned";
}

export async function PATCH(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-booking-status", 30, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { bookingId } = await params;

    const body = (await request.json().catch(() => null)) as { status?: unknown; note?: unknown } | null;
    const targetStatus = body?.status;
    const rawNote = body?.note;
    if (!isBookingStatus(targetStatus)) return errorResponse("Choose a valid booking action.", 400);

    const note = typeof rawNote === "string" ? rawNote.trim() : "";
    if (note.length > 1000) return errorResponse("Administrator notes must be 1,000 characters or fewer.", 400);
    if (NOTE_REQUIRED.has(targetStatus) && !note) {
      return errorResponse("Administrator notes are required for this action.", 400);
    }

    if (targetStatus === "confirmed") {
      const { data: discountCheck } = await supabase
        .from("bookings")
        .select("birthday_discount_amount, birthday_discount_status")
        .eq("id", bookingId)
        .maybeSingle();
      if (
        discountCheck &&
        discountCheck.birthday_discount_amount > 0 &&
        discountCheck.birthday_discount_status !== "verified"
      ) {
        return errorResponse(
          "Verify the renter's birth date against an approved ID before confirming this birthday-discount booking.",
          409,
        );
      }
    }

    if (targetStatus === "approved") {
      const approvalBooking = await getBookingById(supabase, bookingId);
      if (!approvalBooking) return errorResponse("The selected booking no longer exists.", 404);

      const { data: verifiedPayment, error: verifiedPaymentError } = await supabase
        .from("booking_payment_submissions")
        .select("id")
        .eq("booking_id", bookingId)
        .eq("status", "verified")
        .limit(1);
      if (verifiedPaymentError) {
        console.error("Admin approval payment check failed", verifiedPaymentError);
        return errorResponse("The booking could not be checked. Please try again.", 500);
      }

      const blockers = getApprovalBlockers({
        requirementsStatus: approvalBooking.requirementsStatus,
        hasVerifiedPayment: (verifiedPayment?.length ?? 0) > 0,
        agreementStatus: approvalBooking.agreementStatus,
      });
      if (blockers.length > 0) {
        return errorResponse(`Finish these steps before approving: ${blockers.join(" ")}`, 409);
      }
    }

    const { data, error } =
      targetStatus === "confirmed"
        ? await supabase.rpc("confirm_booking", { p_booking_id: bookingId, p_note: note || undefined })
        : await supabase.rpc("admin_set_booking_status", {
            p_booking_id: bookingId,
            p_new_status: targetStatus,
            p_note: note || undefined,
          });

    if (error || !data) {
      const message = error?.message ?? "";
      if (message.includes("BOOKING_NOT_FOUND")) return errorResponse("The selected booking no longer exists.", 404);
      if (message.includes("INVALID_STATUS_TRANSITION")) {
        return errorResponse("That action is not available for the booking's current status.", 409);
      }
      if (message.includes("BOOKING_NOT_APPROVED")) {
        return errorResponse("The booking must be approved before it can be confirmed.", 409);
      }
      if (message.includes("PAYMENT_NOT_VERIFIED")) {
        return errorResponse("A verified payment is required before confirming this booking.", 409);
      }
      if (message.includes("DOCUMENTS_NOT_APPROVED")) {
        return errorResponse("Every verification document must be approved before confirming this booking.", 409);
      }
      if (message.includes("AGREEMENT_NOT_COMPLETED")) {
        return errorResponse("The rental agreement must be fully signed before confirming this booking.", 409);
      }
      if (message.includes("BALANCE_PAYMENT_REQUIRED")) {
        return errorResponse("The remaining balance must be recorded as paid before handover.", 409);
      }
      if (message.includes("INVENTORY_NOT_RESERVED")) {
        return errorResponse(
          "The reserved units for this booking are no longer held, so it can't be confirmed. Check the unit assignments on the booking, then try again.",
          409,
        );
      }
      if (message.includes("SECURITY_DEPOSIT_REQUIRED")) {
        return errorResponse("Record the security deposit before releasing the item.", 409);
      }
      if (message.includes("unit_reservation_status")) {
        return errorResponse("The device return could not be recorded. Refresh the page and try once more.", 500);
      }
      console.error("Admin booking status update failed", error);
      return errorResponse("The booking status could not be updated. Please try again.", 500);
    }

    let customerEmailSent: boolean | null = null;

    if (targetStatus === "approved") {
      // The approval is already saved at this point. sendBookingApprovalEmail never
      // throws, so a failed email is reported back without undoing the approval.
      const outcome = await sendBookingApprovalEmail({
        bookingId,
        origin: new URL(request.url).origin,
      });
      customerEmailSent = outcome.sent;
    } else if (isEmailBookingStatus(targetStatus)) {
      const admin = createAdminClient();
      const [{ data: profile }, { data: items }, { data: bookingAccess }] = await Promise.all([
        admin
          .from("profiles")
          .select("display_name, contact_email")
          .eq("id", data.customer_id)
          .maybeSingle(),
        admin
          .from("booking_items")
          .select("product_name_snapshot")
          .eq("booking_id", bookingId)
          .order("created_at", { ascending: true }),
        admin
          .from("bookings")
          .select("is_guest_checkout")
          .eq("id", bookingId)
          .maybeSingle(),
      ]);

      let customerEmail = profile?.contact_email?.trim() ?? "";
      if (!customerEmail) {
        const { data: authUser } = await admin.auth.admin.getUserById(data.customer_id);
        customerEmail = authUser.user?.email?.trim() ?? "";
      }

      const changedAt = data.returned_at;
      const emailResult = await sendBookingStatusEmail({
        bookingId,
        bookingReference: data.booking_reference,
        customerName: profile?.display_name || "Customer",
        customerEmail,
        productName: bookingHeadline(
          (items ?? []).map((row) => ({ productName: row.product_name_snapshot ?? "Rental item" })),
        ),
        status: targetStatus,
        statusChangedAt: changedAt || data.updated_at,
        bookingUrl: `${new URL(request.url).origin}${bookingTrackingPath(bookingId, bookingAccess?.is_guest_checkout === true)}`,
        isGuest: bookingAccess?.is_guest_checkout === true,
      });
      customerEmailSent = emailResult.sent;
    }

    return NextResponse.json({
      success: true,
      bookingId,
      status: data.status,
      customerEmail: isEmailBookingStatus(targetStatus)
        ? { required: true, sent: customerEmailSent }
        : { required: false, sent: null },
    });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Admin booking status update failed", error);
    return errorResponse("The booking status could not be updated. Please try again.", 500);
  }
}
