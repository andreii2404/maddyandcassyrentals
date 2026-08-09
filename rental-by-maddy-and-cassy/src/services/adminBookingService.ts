import type { BookingStatus } from "@/src/types/booking";

export interface AdminBookingAction {
  status: BookingStatus;
  label: string;
  description: string;
  requiresNote?: boolean;
  tone?: "default" | "danger";
}

// Mirrors the exact transitions admin_set_booking_status() allows server-side:
// review -> confirmation -> handover preparation -> release -> return. Closed
// bookings intentionally expose no additional actions.
export const ADMIN_BOOKING_ACTIONS: Record<BookingStatus, AdminBookingAction[]> = {
  draft: [],
  pending: [
    {
      status: "approved",
      label: "Approve Booking",
      description: "Accept the rental request after checking its basic details and availability.",
    },
    {
      status: "cancelled",
      label: "Decline Booking",
      description: "Close this request and explain the reason clearly to the customer.",
      requiresNote: true,
      tone: "danger",
    },
  ],
  approved: [
    {
      status: "confirmed",
      label: "Confirm Booking",
      description: "Finalize the booking once payment, documents, and the agreement are complete.",
    },
    {
      status: "cancelled",
      label: "Cancel Booking",
      description: "Cancel the approved request and release its reserved dates.",
      requiresNote: true,
      tone: "danger",
    },
  ],
  confirmed: [
    {
      status: "ready_for_release",
      label: "Ready for Handover",
      description: "Tell the customer that the rental is prepared for pickup or delivery.",
    },
    {
      status: "cancelled",
      label: "Cancel Booking",
      description: "Stop this confirmed rental and record the reason for the customer.",
      requiresNote: true,
      tone: "danger",
    },
  ],
  ready_for_release: [
    {
      status: "released",
      label: "Released to Customer",
      description: "Record that the customer received the item through pickup or delivery.",
    },
    {
      status: "cancelled",
      label: "Cancel Booking",
      description: "Cancel before handover and explain why the rental did not proceed.",
      requiresNote: true,
      tone: "danger",
    },
  ],
  released: [{
    status: "returned",
    label: "Complete Return",
    description: "Confirm that the item was returned and close the rental successfully.",
  }],
  returned: [],
  cancelled: [],
  rejected: [],
};

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export async function updateAdminBookingStatus(
  bookingId: string,
  status: BookingStatus,
  note: string,
): Promise<void> {
  const response = await fetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, note }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "The booking status could not be updated."));
  }
}

export async function countersignBookingAgreement(
  bookingId: string,
  signerName: string,
): Promise<void> {
  const response = await fetch(
    `/api/admin/bookings/${encodeURIComponent(bookingId)}/agreement`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signerName, acknowledged: true }),
    },
  );

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "The agreement could not be countersigned."));
  }
}

export async function downloadAdminBookingPdf(bookingId: string, bookingReference: string): Promise<void> {
  const response = await fetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}/pdf`, {
    credentials: "same-origin",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "The booking PDF could not be generated."));
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `booking-${bookingReference.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
