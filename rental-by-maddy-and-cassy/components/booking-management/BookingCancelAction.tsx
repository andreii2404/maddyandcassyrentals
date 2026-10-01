"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/ToastProvider";
import { CANCELLATION_REASON_OPTIONS, type Booking, type BookingStatus } from "@/src/types/booking";
import { canCustomerCancelBooking } from "@/src/lib/bookingManagement";
import { requestCancellationAsCustomer } from "@/src/services/bookingService";
import { createClient } from "@/src/lib/supabase/client";
import styles from "./BookingCancelAction.module.css";

interface Props {
  booking: Booking;
  onUpdated: () => Promise<void>;
  /**
   * "detail" (default) always shows the trigger, disabled with a reason when unavailable.
   * "inline" is for compact list cards: it renders nothing unless the booking can be cancelled.
   */
  layout?: "detail" | "inline";
}

/** Why the customer can't cancel online, using the same rules as CustomerBookingManagement. */
function getUnavailableReason(status: BookingStatus, pendingRequest: boolean): string {
  if (pendingRequest) return "Cancellation already requested. It is waiting for administrator review.";
  switch (status) {
    case "cancelled":
      return "This booking has already been cancelled.";
    case "rejected":
      return "This booking was declined, so it can no longer be cancelled.";
    case "returned":
      return "This rental is complete and can no longer be cancelled.";
    case "draft":
      return "Online cancellation is not available for draft bookings. Contact the business for assistance.";
    default:
      return "Online cancellation closes once a booking is confirmed. Contact the business for assistance.";
  }
}

export default function BookingCancelAction({ booking, onUpdated, layout = "detail" }: Props) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [additionalDetails, setAdditionalDetails] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const descriptionId = useId();
  const unavailableId = useId();
  const reasonFieldId = useId();
  const reasonErrorId = useId();
  const detailsFieldId = useId();

  const pendingRequest = booking.cancellationRequest?.status === "pending";
  const canCancel = canCustomerCancelBooking(booking.status) && !pendingRequest;

  function closeModal() {
    if (cancelling) return;
    setOpen(false);
    setReasonError(false);
  }

  async function confirmCancellation() {
    if (cancelling || !canCancel) return;
    if (!CANCELLATION_REASON_OPTIONS.includes(reason as (typeof CANCELLATION_REASON_OPTIONS)[number])) {
      setReasonError(true);
      return;
    }
    setCancelling(true);
    try {
      await requestCancellationAsCustomer(createClient(), booking.id, reason, additionalDetails);
      await onUpdated();
      setOpen(false);
      setReason("");
      setAdditionalDetails("");
      showToast("Your cancellation request has been submitted and is waiting for business approval.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The cancellation request could not be submitted.", "error");
    } finally {
      setCancelling(false);
    }
  }

  const inline = layout === "inline";
  if (inline && !canCancel) return null;

  return (
    <div className={inline ? styles.actionInline : styles.action}>
      <Button
        variant="none"
        type="button"
        className={inline ? `${styles.cancelTrigger} ${styles.cancelTriggerInline}` : styles.cancelTrigger}
        disabled={!canCancel}
        aria-describedby={canCancel ? undefined : unavailableId}
        onClick={() => setOpen(true)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="m15 9-6 6M9 9l6 6" strokeLinecap="round" />
        </svg>
        {pendingRequest ? "Cancellation Requested" : "Cancel Booking"}
      </Button>
      {!canCancel ? (
        <p id={unavailableId} className={styles.unavailableNote}>
          {getUnavailableReason(booking.status, pendingRequest)}
        </p>
      ) : null}

      {open && canCancel ? (
        <Modal title="Cancel booking" onClose={closeModal} describedBy={descriptionId}>
          <div className={styles.confirmation}>
            <div id={descriptionId} className={styles.confirmationIntro}>
              <p className={styles.prompt}>Are you sure you want to cancel this booking?</p>
              <div className={styles.bookingRef}>
                <span>Booking ID</span>
                <strong>{booking.bookingRef}</strong>
              </div>
              <p className={styles.notice}>
                Your booking stays active until an administrator approves the cancellation. Reserved dates remain
                held during review. Payments and the required deposit remain subject to the rental terms.
              </p>
            </div>

            <label htmlFor={reasonFieldId} className={styles.field}>
              <span>Reason to Cancel</span>
              <select
                id={reasonFieldId}
                value={reason}
                onChange={(event) => { setReason(event.target.value); setReasonError(false); }}
                required
                disabled={cancelling}
                aria-invalid={reasonError}
                aria-describedby={reasonError ? reasonErrorId : undefined}
              >
                <option value="">Select a reason</option>
                {CANCELLATION_REASON_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              {reasonError ? (
                <small id={reasonErrorId} className={styles.fieldError} role="alert">
                  Choose a reason for cancelling this booking.
                </small>
              ) : null}
            </label>

            <label htmlFor={detailsFieldId} className={styles.field}>
              <span>Additional Details <em>(optional)</em></span>
              <textarea
                id={detailsFieldId}
                value={additionalDetails}
                onChange={(event) => setAdditionalDetails(event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Add any extra explanation, if helpful"
                disabled={cancelling}
              />
            </label>

            <div className={styles.actions}>
              <Button variant="secondary" type="button" onClick={closeModal} disabled={cancelling}>
                Keep Booking
              </Button>
              <Button
                variant="danger"
                type="button"
                loading={cancelling}
                loadingText="Cancelling…"
                onClick={() => void confirmCancellation()}
              >
                Cancel Booking
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
