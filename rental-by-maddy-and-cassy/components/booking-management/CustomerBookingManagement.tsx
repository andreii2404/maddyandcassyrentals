"use client";

import { useMemo, useState } from "react";
import {
  CANCELLATION_REASON_OPTIONS,
  type AgreementDoc,
  type Booking,
  type BookingDocument,
  type StatusHistoryEntry,
} from "@/src/types/booking";
import type { PaymentRecord } from "@/src/types/payment";
import {
  canCustomerCancelBooking,
  canCustomerEditBooking,
  getBookingMilestones,
  getBookingStatusMessage,
  getFulfillmentProgressLabel,
  getRejectionReason,
  parseDeclineNote,
} from "@/src/lib/bookingManagement";
import {
  requestCancellationAsCustomer,
  updateBookingDetailsAsCustomer,
} from "@/src/services/bookingService";
import { createClient } from "@/src/lib/supabase/client";
import { useToast } from "@/components/ui/ToastProvider";
import StatusBadge from "@/components/status-badge/StatusBadge";
import Modal from "@/components/ui/Modal";
import styles from "./CustomerBookingManagement.module.css";

interface Props {
  booking: Booking;
  payments: PaymentRecord[];
  documents: BookingDocument[];
  agreement: AgreementDoc | null;
  statusHistory: StatusHistoryEntry[];
  onUpdated: () => Promise<void>;
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatStatus(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function CustomerBookingManagement({
  booking,
  payments,
  documents,
  agreement,
  statusHistory,
  onUpdated,
}: Props) {
  const { showToast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelAdditionalDetails, setCancelAdditionalDetails] = useState("");
  const [reasonModalOpen, setReasonModalOpen] = useState(false);
  const [fulfillmentMethod, setFulfillmentMethod] = useState(booking.fulfillmentMethod);
  const [location, setLocation] = useState(booking.location ?? "");
  const [cityMunicipality, setCityMunicipality] = useState(booking.cityMunicipality ?? "");
  const [province, setProvince] = useState(booking.province ?? "");
  const [customerNotes, setCustomerNotes] = useState(booking.customerNotes ?? "");

  const lockedProgress = useMemo(
    () => payments.some((payment) => ["submitted", "under_review", "verified"].includes(payment.status))
      || documents.length > 0
      || agreement !== null,
    [agreement, documents.length, payments],
  );
  const pendingCancellationRequest = booking.cancellationRequest?.status === "pending";
  const canEdit = canCustomerEditBooking(booking, lockedProgress) && !pendingCancellationRequest;
  const canCancel = canCustomerCancelBooking(booking.status) && !pendingCancellationRequest;
  const milestones = getBookingMilestones(booking);
  const rejectionReason = booking.status === "rejected" ? getRejectionReason(statusHistory) : undefined;
  const parsedRejection = rejectionReason ? parseDeclineNote(rejectionReason) : undefined;

  async function handleEditSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fulfillmentMethod === "delivery" && (!location.trim() || !cityMunicipality.trim() || !province.trim())) {
      showToast("Enter the complete street/barangay, city or municipality, and province.", "error");
      return;
    }
    setSaving(true);
    try {
      await updateBookingDetailsAsCustomer(createClient(), booking.id, {
        fulfillmentMethod,
        location: fulfillmentMethod === "delivery" ? location.trim() : undefined,
        cityMunicipality: fulfillmentMethod === "delivery" ? cityMunicipality.trim() : undefined,
        province: fulfillmentMethod === "delivery" ? province.trim() : undefined,
        customerNotes: customerNotes.trim(),
      });
      await onUpdated();
      setEditOpen(false);
      showToast("Booking details updated.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The booking could not be updated.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!CANCELLATION_REASON_OPTIONS.includes(cancelReason as (typeof CANCELLATION_REASON_OPTIONS)[number])) {
      showToast("Choose a reason for cancelling this booking.", "error");
      return;
    }
    if (!window.confirm(`Submit a cancellation request for booking ${booking.bookingRef}? The booking will remain active until an administrator reviews it.`)) return;

    setCancelling(true);
    try {
      await requestCancellationAsCustomer(
        createClient(),
        booking.id,
        cancelReason,
        cancelAdditionalDetails,
      );
      await onUpdated();
      setCancelOpen(false);
      setCancelReason("");
      setCancelAdditionalDetails("");
      showToast("Your cancellation request has been submitted and is waiting for business approval.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The booking could not be cancelled.", "error");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <section className={styles.statusHero} aria-labelledby="current-status-heading">
        <div className={styles.statusTopline}>
          <div>
            <p>CURRENT BOOKING STATUS</p>
            <h2 id="current-status-heading">{getFulfillmentProgressLabel(booking.status, booking.fulfillmentMethod)}</h2>
          </div>
          {rejectionReason ? (
            <button
              type="button"
              className={styles.rejectedBadgeButton}
              onClick={() => setReasonModalOpen(true)}
            >
              <StatusBadge status={booking.status} />
            </button>
          ) : (
            <StatusBadge status={booking.status} />
          )}
        </div>
        <p className={styles.statusMessage}>
          {pendingCancellationRequest
            ? "Your cancellation request is waiting for administrator review. The booking remains active until a decision is made."
            : getBookingStatusMessage(booking.status, booking.fulfillmentMethod)}
        </p>
        {pendingCancellationRequest ? (
          <div className={styles.cancellationPending} role="status" aria-live="polite">
            <span>Cancellation Requested</span>
            <strong>Waiting for Approval</strong>
          </div>
        ) : null}
        {rejectionReason ? (
          <button type="button" className={styles.viewReasonLink} onClick={() => setReasonModalOpen(true)}>
            View rejection reason
          </button>
        ) : null}
        <dl className={styles.statusFacts}>
          <div><dt>Reference number</dt><dd>{booking.bookingRef}</dd></div>
          <div><dt>Fulfillment</dt><dd>{booking.fulfillmentMethod === "delivery" ? "Delivery" : "Pickup"}</dd></div>
          <div><dt>Last updated</dt><dd>{formatDateTime(booking.updatedAt)}</dd></div>
        </dl>
      </section>

      <section className={styles.timelineSection} aria-labelledby="tracking-heading">
        <div className={styles.sectionHeading}>
          <div><p>BOOKING TRACKER</p><h2 id="tracking-heading">From request to completion</h2></div>
          <span>{milestones.filter((milestone) => milestone.completed).length} of {milestones.length} milestones</span>
        </div>
        <ol className={styles.milestones}>
          {milestones.map((milestone) => (
            <li
              key={milestone.key}
              className={`${milestone.completed ? styles.milestoneCompleted : ""} ${milestone.current ? styles.milestoneCurrent : ""}`}
            >
              <span className={styles.milestoneDot} aria-hidden="true">{milestone.completed ? "✓" : ""}</span>
              <div>
                <strong>{milestone.label}</strong>
                <p>{milestone.description}</p>
                {milestone.timestamp ? <small>{formatDateTime(milestone.timestamp)}</small> : null}
              </div>
            </li>
          ))}
        </ol>

        {statusHistory.length ? (
          <details className={styles.activity}>
            <summary>View detailed status activity ({statusHistory.length})</summary>
            <ol>
              {statusHistory.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>{entry.fromStatus ? `${formatStatus(entry.fromStatus)} → ` : ""}{formatStatus(entry.toStatus)}</strong>
                    <small>{formatDateTime(entry.createdAt)}</small>
                  </div>
                  {entry.note ? <p>{entry.note}</p> : null}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </section>

      <section className={styles.management} aria-labelledby="manage-booking-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p>SELF-SERVICE</p>
            <h2 id="manage-booking-heading">Manage this booking</h2>
            <span className={styles.headingHelp}>Available actions change as your booking moves forward.</span>
          </div>
          <span className={styles.managementHint}>Safe account controls</span>
        </div>

        <div className={styles.managementGrid}>
          <article>
            <div className={styles.actionHeader}>
              <span className={styles.actionIcon} aria-hidden="true">EDIT</span>
              <span className={`${styles.actionAvailability} ${canEdit ? styles.available : styles.locked}`}>{canEdit ? "Available" : "Locked"}</span>
            </div>
            <h3>Edit safe details</h3>
            <p>{canEdit ? "Update pickup/delivery information and notes before payment or verification begins." : "Editing is locked once payment or verification begins. Contact the business for changes."}</p>
            <button type="button" disabled={!canEdit} onClick={() => { setEditOpen((open) => !open); setCancelOpen(false); }}>
              {editOpen ? "Close editor" : "Edit booking details"}
            </button>
          </article>
          <article>
            <div className={styles.actionHeader}>
              <span className={`${styles.actionIcon} ${styles.cancelIcon}`} aria-hidden="true">CANCEL</span>
              <span className={`${styles.actionAvailability} ${canCancel ? styles.available : styles.locked}`}>{canCancel ? "Available" : "Locked"}</span>
            </div>
            <h3>Cancel booking</h3>
            <p>
              {pendingCancellationRequest
                ? "Your cancellation request is under review. Reserved dates remain held until the administrator decides."
                : canCancel
                  ? "Send a cancellation request for administrator review. Reserved dates remain held until it is approved."
                  : "Online cancellation requests are unavailable at this stage. Contact the business for assistance."}
            </p>
            <button type="button" className={styles.cancelButton} disabled={!canCancel} onClick={() => { setCancelOpen((open) => !open); setEditOpen(false); }}>
              {cancelOpen ? "Keep booking" : "Request cancellation"}
            </button>
          </article>
        </div>

        {editOpen && canEdit ? (
          <form className={styles.editForm} onSubmit={handleEditSubmit}>
            <div className={styles.formHeading}><strong>Edit booking details</strong><span>Rental dates and item quantity require a new booking.</span></div>
            <fieldset>
              <legend>Pickup or delivery</legend>
              <label><input type="radio" name="fulfillment" checked={fulfillmentMethod === "pickup"} onChange={() => setFulfillmentMethod("pickup")} /> Pickup</label>
              <label><input type="radio" name="fulfillment" checked={fulfillmentMethod === "delivery"} onChange={() => setFulfillmentMethod("delivery")} /> Delivery</label>
            </fieldset>
            {fulfillmentMethod === "delivery" ? (
              <div className={styles.addressGrid}>
                <label><span>Street / Barangay</span><input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={240} required /></label>
                <label><span>City / Municipality</span><input value={cityMunicipality} onChange={(event) => setCityMunicipality(event.target.value)} maxLength={120} required /></label>
                <label><span>Province</span><input value={province} onChange={(event) => setProvince(event.target.value)} maxLength={120} required /></label>
              </div>
            ) : null}
            <label className={styles.notesField}><span>Booking notes</span><textarea value={customerNotes} onChange={(event) => setCustomerNotes(event.target.value)} maxLength={1000} rows={3} placeholder="Optional instructions or notes" /></label>
            <button type="submit" className={styles.saveButton} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
          </form>
        ) : null}

        {cancelOpen && canCancel ? (
          <form className={styles.cancelPanel} onSubmit={(event) => void handleCancel(event)}>
            <strong>Request cancellation review</strong>
            <p>The booking stays active while the business reviews your request. Reserved dates are released only if the request is approved. Payments and the required deposit remain subject to the rental terms.</p>
            <label>
              <span>Reason to Cancel</span>
              <select value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} required disabled={cancelling}>
                <option value="">Select a reason</option>
                {CANCELLATION_REASON_OPTIONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
              </select>
            </label>
            <label>
              <span>Additional Details <em>(optional)</em></span>
              <textarea value={cancelAdditionalDetails} onChange={(event) => setCancelAdditionalDetails(event.target.value)} maxLength={1000} rows={3} placeholder="Add any extra explanation, if helpful" disabled={cancelling} />
            </label>
            <button type="submit" disabled={cancelling}>{cancelling ? "Submitting…" : "Submit cancellation request"}</button>
          </form>
        ) : null}
      </section>

      {reasonModalOpen && rejectionReason ? (
        <Modal title="Booking rejected" onClose={() => setReasonModalOpen(false)}>
          {parsedRejection ? (
            <>
              <span className={styles.rejectionReasonLabel}>{parsedRejection.reason}</span>
              <p className={styles.rejectionReasonText}>{parsedRejection.details}</p>
            </>
          ) : (
            <p className={styles.rejectionReasonText}>{rejectionReason}</p>
          )}
        </Modal>
      ) : null}
    </>
  );
}
