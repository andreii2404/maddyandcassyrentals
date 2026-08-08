"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/src/lib/supabase/client";
import {
  getBookingDetails,
  getBookingFileUrl,
  type BookingDetails,
} from "@/src/services/bookingDetailService";
import {
  ADMIN_BOOKING_ACTIONS,
  downloadAdminBookingPdf,
  updateAdminBookingStatus,
} from "@/src/services/adminBookingService";
import { getUserProfile } from "@/src/services/userService";
import { getBookingPayments, getBookingReceipts } from "@/src/services/paymentService";
import type { BookingStatus, UserProfile } from "@/src/types/database";
import type { PaymentRecord, BookingReceipt } from "@/src/types/payment";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "@/components/status-badge/StatusBadge";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./bookingDetail.module.css";
import RequirementsReviewPanel from "@/components/admin/RequirementsReviewPanel";

const REQUIREMENTS_STATUS_LABELS: Record<string, string> = {
  not_submitted: "Not Submitted",
  pending_review: "Pending Review",
  approved: "Approved",
  rejected: "Rejected",
};

const AGREEMENT_STATUS_LABELS: Record<string, string> = {
  not_created: "Not Created",
  awaiting_customer_signature: "Awaiting Customer Signature",
  awaiting_business_signature: "Awaiting Business Signature",
  completed: "Completed",
  rejected: "Rejected",
};

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit", hour12: true } : {}),
  });
}

function formatStatus(value: string | null | undefined) {
  if (!value) return "-";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeExternalLink(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

interface DetailState {
  details: BookingDetails;
  profile: UserProfile | null;
  payments: PaymentRecord[];
  receipts: BookingReceipt[];
}

export default function AdminBookingDetail({ bookingId }: { bookingId: string }) {
  const { showToast } = useToast();
  const [state, setState] = useState<DetailState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<"" | BookingStatus>("");
  const [note, setNote] = useState("");
  const [updating, setUpdating] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadDetails = useCallback(async () => {
    try {
      const supabase = createClient();
      const details = await getBookingDetails(supabase, bookingId);
      if (!details) {
        setError("The selected booking could not be found.");
        return;
      }
      const [profile, payments, receipts] = await Promise.all([
        getUserProfile(details.booking.customerId),
        getBookingPayments(supabase, bookingId),
        getBookingReceipts(supabase, bookingId),
      ]);
      setState({ details, profile, payments, receipts });
      setError(null);
    } catch {
      setError("The booking details could not be loaded. Please refresh and try again.");
    }
  }, [bookingId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDetails();
  }, [loadDetails]);

  const actions = useMemo(
    () => (state ? ADMIN_BOOKING_ACTIONS[state.details.booking.status] : []),
    [state],
  );

  const selectedAction = actions.find((action) => action.status === selectedStatus);

  async function openPrivateFile(bucket: Parameters<typeof getBookingFileUrl>[1], path: string) {
    const previewWindow = window.open("", "_blank");
    if (previewWindow) {
      previewWindow.document.title = "Loading private document...";
      previewWindow.document.body.textContent = "Loading private document...";
    }

    try {
      const supabase = createClient();
      const url = await getBookingFileUrl(supabase, bucket, path);
      if (previewWindow) {
        previewWindow.location.href = url;
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch {
      previewWindow?.close();
      showToast("This private document could not be opened.", "error");
    }
  }

  async function handleStatusAction() {
    if (!state || !selectedStatus || !selectedAction) return;
    if (selectedAction.requiresNote && !note.trim()) {
      showToast("Please add administrator notes for this action.", "error");
      return;
    }

    const confirmed = window.confirm(
      `Apply "${selectedAction.label}" to booking ${state.details.booking.bookingRef}?`,
    );
    if (!confirmed) return;

    setUpdating(true);
    try {
      await updateAdminBookingStatus(bookingId, selectedStatus, note);
      await loadDetails();
      setSelectedStatus("");
      setNote("");
      showToast(`Booking updated: ${selectedAction.label}.`, "success");
    } catch (actionError) {
      showToast(
        actionError instanceof Error ? actionError.message : "The booking status could not be updated.",
        "error",
      );
    } finally {
      setUpdating(false);
    }
  }

  async function handlePdfExport() {
    if (!state) return;
    setExporting(true);
    try {
      await downloadAdminBookingPdf(bookingId, state.details.booking.bookingRef);
      showToast("The private booking PDF was downloaded.", "success");
    } catch (exportError) {
      showToast(
        exportError instanceof Error ? exportError.message : "The booking PDF could not be generated.",
        "error",
      );
    } finally {
      setExporting(false);
    }
  }

  if (error) {
    return (
      <div className={styles.page}>
        <Link href="/admin/bookings" className={styles.backLink}>Back to Bookings</Link>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className={styles.loading}>
        <Spinner size={30} label="Loading booking details" />
      </div>
    );
  }

  const { booking, emergencyContact, agreement, statusHistory, documents } = state.details;
  const { profile, payments, receipts } = state;
  const customer = booking.customerSnapshot;
  const fullName = customer?.fullName || profile?.displayName || "Customer";
  const email = customer?.email || profile?.email || "-";
  const phone = customer?.phone || profile?.phoneNumber || "-";
  const address = customer?.address || profile?.fullAddress || "-";
  const facebook = safeExternalLink(customer?.facebookLink || profile?.facebookLink);
  const instagram = safeExternalLink(customer?.instagramLink || profile?.instagramLink);
  const totalAmount = `PHP ${booking.totalAmount.toLocaleString("en-PH")}`;
  const customerSignature = agreement?.signatures?.find((s) => s.signerRole === "customer");

  const amountPaid = payments
    .filter((p) => p.status === "verified")
    .reduce((sum, p) => sum + p.amount, 0);
  const paymentStatusLabel =
    amountPaid <= 0 ? "Unpaid" : amountPaid >= booking.totalAmount - 0.01 ? "Paid" : "Partially Paid";

  return (
    <div className={styles.page}>
      <Link href="/admin/bookings" className={styles.backLink}>Back to Bookings</Link>

      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>BOOKING REVIEW</p>
          <h1>{booking.bookingRef}</h1>
          <p>{booking.productSnapshot.name} for {fullName}</p>
        </div>
        <div className={styles.headerActions}>
          <StatusBadge status={booking.status} />
          <button
            type="button"
            className={styles.exportButton}
            onClick={handlePdfExport}
            disabled={exporting}
          >
            {exporting ? "Preparing PDF..." : "Export to PDF"}
          </button>
        </div>
      </header>

      <section className={styles.actionPanel} aria-labelledby="booking-action-heading">
        <div>
          <h2 id="booking-action-heading">Booking Action</h2>
          <p>Choose the next status. Every action is recorded and notifies the customer.</p>
        </div>
        {actions.length ? (
          <div className={styles.actionControls}>
            <label>
              <span>Action</span>
              <select
                value={selectedStatus}
                onChange={(event) => setSelectedStatus(event.target.value as "" | BookingStatus)}
                disabled={updating}
              >
                <option value="">Select an action</option>
                {actions.map((action) => (
                  <option key={action.status} value={action.status}>
                    {action.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.noteField}>
              <span>
                Administrator notes
                {selectedAction?.requiresNote ? " (required)" : " (optional)"}
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Add a clear note for the customer and status history."
                disabled={updating}
              />
            </label>
            <button
              type="button"
              className={`${styles.applyButton} ${
                selectedAction?.tone === "danger" ? styles.dangerButton : ""
              }`}
              onClick={handleStatusAction}
              disabled={!selectedStatus || updating}
            >
              {updating ? "Applying..." : "Apply Action"}
            </button>
          </div>
        ) : (
          <p className={styles.terminalNotice}>
            This booking is in a final status. No further actions are available.
          </p>
        )}
      </section>

      <div className={styles.statusGrid}>
        <article>
          <span>Booking Status</span>
          <strong>{formatStatus(booking.status)}</strong>
        </article>
        <article>
          <span>Requirements</span>
          <strong>{REQUIREMENTS_STATUS_LABELS[booking.requirementsStatus] ?? formatStatus(booking.requirementsStatus)}</strong>
        </article>
        <article>
          <span>Agreement</span>
          <strong>{AGREEMENT_STATUS_LABELS[booking.agreementStatus] ?? formatStatus(booking.agreementStatus)}</strong>
        </article>
        <article>
          <span>Created</span>
          <strong>{formatDate(booking.createdAt, true)}</strong>
        </article>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <p>01</p>
            <h2>Customer Information</h2>
          </div>
          <Link href={`/admin/users/${booking.customerId}`}>View Customer Account</Link>
        </div>
        <dl className={styles.detailGrid}>
          <div><dt>Full name</dt><dd>{fullName}</dd></div>
          <div><dt>Email address</dt><dd>{email}</dd></div>
          <div><dt>Phone number</dt><dd>{phone}</dd></div>
          <div className={styles.wideDetail}><dt>Complete address</dt><dd>{address}</dd></div>
          <div>
            <dt>Facebook profile</dt>
            <dd>{facebook ? <a href={facebook} target="_blank" rel="noopener noreferrer">Open Facebook</a> : "-"}</dd>
          </div>
          <div>
            <dt>Instagram profile</dt>
            <dd>{instagram ? <a href={instagram} target="_blank" rel="noopener noreferrer">Open Instagram</a> : "-"}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div><p>02</p><h2>Rental Details</h2></div>
        </div>
        <dl className={styles.detailGrid}>
          <div><dt>Rental item</dt><dd>{booking.productSnapshot.name}</dd></div>
          <div><dt>Brand / Category</dt><dd>{booking.productSnapshot.brand} / {booking.productSnapshot.category}</dd></div>
          <div><dt>Start date</dt><dd>{formatDate(booking.startDate)}</dd></div>
          <div><dt>End date</dt><dd>{formatDate(booking.endDate)}</dd></div>
          <div><dt>Duration</dt><dd>{booking.dayCount} day(s)</dd></div>
          <div><dt>Quantity</dt><dd>{booking.quantity} unit(s)</dd></div>
          <div><dt>Rental subtotal</dt><dd>PHP {booking.rentalSubtotal.toLocaleString("en-PH")}</dd></div>
          <div><dt>Non-refundable deposit</dt><dd>PHP {booking.refundableDeposit.toLocaleString("en-PH")}</dd></div>
          <div><dt>Total amount</dt><dd>{totalAmount}</dd></div>
          <div><dt>Handover method</dt><dd>{formatStatus(booking.fulfillmentMethod)}</dd></div>
          <div><dt>Assigned unit</dt><dd>{booking.inventoryUnitId || "Not assigned"}</dd></div>
          <div className={styles.wideDetail}><dt>Location</dt><dd>{booking.location || "-"}</dd></div>
          <div className={styles.wideDetail}>
            <dt>Included accessories</dt>
            <dd>{booking.productSnapshot.included?.length ? booking.productSnapshot.included.join(", ") : "None listed"}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div><p>03</p><h2>Rental Requirements</h2></div>
        </div>
        {emergencyContact || documents.length ? (
          <>
            {emergencyContact ? (
              <dl className={styles.detailGrid}>
                <div><dt>Emergency contact</dt><dd>{emergencyContact.fullName}</dd></div>
                <div><dt>Relationship</dt><dd>{emergencyContact.relationship}</dd></div>
                <div><dt>Emergency phone</dt><dd>{emergencyContact.phoneNumber}</dd></div>
                <div><dt>Address</dt><dd>{emergencyContact.address || "-"}</dd></div>
              </dl>
            ) : null}
            <div className={styles.documents}>
              {documents.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  onClick={() => openPrivateFile("booking-documents", document.storagePath)}
                >
                  <span>{formatStatus(document.documentType)}</span>
                  <strong>View private file</strong>
                </button>
              ))}
            </div>
            <RequirementsReviewPanel
              bookingId={bookingId}
              documents={documents}
              onUpdated={loadDetails}
            />
          </>
        ) : (
          <p className={styles.empty}>Requirements have not been submitted for this booking.</p>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div><p>04</p><h2>Rental Agreement</h2></div>
        </div>
        {agreement ? (
          <>
            <dl className={styles.detailGrid}>
              <div><dt>Signed name</dt><dd>{customerSignature?.signerName ?? "-"}</dd></div>
              <div><dt>Signed at</dt><dd>{formatDate(customerSignature?.signedAt, true)}</dd></div>
              <div><dt>Agreement version</dt><dd>{agreement.versionNumber ? `v${agreement.versionNumber}` : "-"}</dd></div>
              <div><dt>Agreement status</dt><dd>{AGREEMENT_STATUS_LABELS[agreement.status] ?? formatStatus(agreement.status)}</dd></div>
            </dl>
            {customerSignature?.signaturePath ? (
              <button
                type="button"
                className={styles.signatureButton}
                onClick={() => openPrivateFile("customer-documents", customerSignature.signaturePath!)}
              >
                View customer signature
              </button>
            ) : null}
          </>
        ) : (
          <p className={styles.empty}>The rental agreement has not been submitted.</p>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div><p>05</p><h2>Payment &amp; Customer Documents</h2></div>
        </div>
        <dl className={styles.detailGrid}>
          <div><dt>Payment status</dt><dd>{paymentStatusLabel}</dd></div>
          <div><dt>Payment attempts</dt><dd>{payments.length}</dd></div>
          <div><dt>Receipts</dt><dd>{receipts.length}</dd></div>
        </dl>
        {receipts.length ? (
          <div className={styles.documents}>
            {receipts
              .filter((receipt) => receipt.documentPath)
              .map((receipt) => (
                <button
                  key={receipt.id}
                  type="button"
                  onClick={() => openPrivateFile("receipts", receipt.documentPath!)}
                >
                  <span>Receipt {receipt.receiptNumber ?? receipt.id.slice(0, 8)}</span>
                  <strong>View private PDF</strong>
                </button>
              ))}
          </div>
        ) : (
          <p className={styles.empty}>No customer-facing financial documents have been issued yet.</p>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div><p>06</p><h2>Status History</h2></div>
        </div>
        {statusHistory.length ? (
          <ol className={styles.timeline}>
            {statusHistory.map((entry) => (
              <li key={entry.id}>
                <span aria-hidden="true" />
                <div>
                  <strong>
                    {entry.fromStatus ? `${formatStatus(entry.fromStatus)} to ` : ""}
                    {formatStatus(entry.toStatus)}
                  </strong>
                  <p>{entry.note || "Status updated."}</p>
                  <small>{formatDate(entry.createdAt, true)}</small>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.empty}>No status history is available.</p>
        )}
      </section>
    </div>
  );
}
