import type { BookingStatus } from "@/src/types/booking";

export interface AdminBookingAction {
  status: BookingStatus;
  label: string;
  requiresNote?: boolean;
  tone?: "default" | "danger";
}

// Mirrors the exact transitions admin_set_booking_status() allows server-side
// (pending->approved/cancelled, approved->confirmed/cancelled,
// confirmed->released/cancelled, released->returned). 'draft', 'rejected',
// and 'ready_for_release' are reachable in the booking_status enum but are
// not produced or accepted by any current RPC, so they offer no actions.
export const ADMIN_BOOKING_ACTIONS: Record<BookingStatus, AdminBookingAction[]> = {
  draft: [],
  pending: [
    { status: "approved", label: "Approve Booking" },
    { status: "cancelled", label: "Reject Booking", requiresNote: true, tone: "danger" },
  ],
  approved: [
    { status: "confirmed", label: "Confirm Booking" },
    { status: "cancelled", label: "Cancel Booking", requiresNote: true, tone: "danger" },
  ],
  confirmed: [
    { status: "ready_for_release", label: "Mark Ready for Handover" },
    { status: "cancelled", label: "Cancel Booking", requiresNote: true, tone: "danger" },
  ],
  ready_for_release: [
    { status: "released", label: "Mark Released to Customer" },
    { status: "cancelled", label: "Cancel Booking", requiresNote: true, tone: "danger" },
  ],
  released: [{ status: "returned", label: "Mark Returned" }],
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
