"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/src/lib/supabase/client";
import {
  getBookingDetails,
  getBookingFileUrl,
  type BookingDetails,
} from "@/src/services/bookingDetailService";
import {
  ADMIN_BOOKING_ACTIONS,
  countersignBookingAgreement,
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
import {
  getBookingLiveStatusLabel,
  useBookingRealtime,
} from "@/hooks/useBookingRealtime";
import styles from "./bookingDetail.module.css";
import RequirementsReviewPanel from "@/components/admin/RequirementsReviewPanel";
import PaymentsReviewPanel from "@/components/admin/PaymentsReviewPanel";
import { getBookingMilestones, getFulfillmentProgressLabel } from "@/src/lib/bookingManagement";

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
  const [businessSignerName, setBusinessSignerName] = useState("");
  const [countersignAcknowledged, setCountersignAcknowledged] = useState(false);
  const [countersigning, setCountersigning] = useState(false);
  const [statusConfirmationOpen, setStatusConfirmationOpen] = useState(false);
  const confirmationDialogRef = useRef<HTMLDivElement>(null);

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

  const liveStatus = useBookingRealtime({ bookingId, onChange: loadDetails });

  const actions = useMemo(
    () => (state ? ADMIN_BOOKING_ACTIONS[state.details.booking.status] : []),
    [state],
  );

  const selectedAction = actions.find((action) => action.status === selectedStatus);

  useEffect(() => {
    if (!statusConfirmationOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    confirmationDialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !updating) setStatusConfirmationOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [statusConfirmationOpen, updating]);

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

  function requestStatusAction() {
    if (!state || !selectedStatus || !selectedAction) return;
    if (selectedAction.requiresNote && !note.trim()) {
      showToast("Please add administrator notes for this action.", "error");
      return;
    }
    setStatusConfirmationOpen(true);
  }

  async function confirmStatusAction() {
    if (!state || !selectedStatus || !selectedAction) return;
    setUpdating(true);
    try {
      const supabase = createClient();
      const { data: freshBooking, error: freshError } = await supabase
        .from("bookings")
        .select("status")
        .eq("id", bookingId)
        .maybeSingle();
      if (freshError) throw new Error("The booking status could not be verified. Please try again.");
      if (!freshBooking) throw new Error("The selected booking no longer exists.");

      const freshActions = ADMIN_BOOKING_ACTIONS[freshBooking.status as BookingStatus];
      if (!freshActions.some((action) => action.status === selectedStatus)) {
        showToast(
          "This booking's status changed since the page loaded. Details have been refreshed — please review and try again.",
          "error",
        );
        await loadDetails();
        setStatusConfirmationOpen(false);
        setSelectedStatus("");
        setNote("");
        return;
      }

      const updateResult = await updateAdminBookingStatus(bookingId, selectedStatus, note);
      await loadDetails();
      setStatusConfirmationOpen(false);
      setSelectedStatus("");
      setNote("");
      if (updateResult.emailRequired && !updateResult.emailSent) {
        showToast(
          updateResult.emailReason === "not_configured"
            ? `Booking updated: ${selectedAction.label}. Add the booking email settings in Vercel to send customer emails.`
            : `Booking updated: ${selectedAction.label}. The customer email could not be delivered; please contact the customer directly.`,
          "error",
        );
      } else {
        showToast(
          `${selectedAction.label} completed.${updateResult.emailSent ? " The customer was emailed automatically." : ""}`,
          "success",
        );
      }
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

  async function handleCountersignAgreement() {
    if (!businessSignerName.trim()) {
      showToast("Enter the authorized business signer's complete name.", "error");
      return;
    }
    if (!countersignAcknowledged) {
      showToast("Confirm that you are authorized to countersign for the business.", "error");
      return;
    }
    if (!window.confirm(`Countersign and finalize the agreement as ${businessSignerName.trim()}?`)) return;

    setCountersigning(true);
    try {
      await countersignBookingAgreement(bookingId, businessSignerName.trim());
      await loadDetails();
      setCountersignAcknowledged(false);
      showToast("Agreement countersigned. The final PDF is ready for the customer.", "success");
    } catch (countersignError) {
      showToast(
        countersignError instanceof Error
          ? countersignError.message
          : "The agreement could not be countersigned.",
        "error",
      );
    } finally {
      setCountersigning(false);
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
  const businessSignature = agreement?.signatures?.find((s) => s.signerRole === "business");

  const amountPaid = payments
    .filter((p) => p.status === "verified")
    .reduce((sum, p) => sum + p.amount, 0);
  const paymentStatusLabel =
    amountPaid <= 0 ? "Unpaid" : amountPaid >= booking.totalAmount - 0.01 ? "Paid" : "Partially Paid";
  const canCountersignAgreement = Boolean(
    agreement?.status === "awaiting_business_signature" &&
    customerSignature &&
    amountPaid > 0 &&
    booking.requirementsStatus === "approved",
  );
  const reviewChecks = [
    {
      label: "Payment",
      value: paymentStatusLabel,
      detail: amountPaid > 0
        ? `PHP ${amountPaid.toLocaleString("en-PH")} verified`
        : "No verified payment",
      ready: amountPaid > 0,
    },
    {
      label: "Verification",
      value: REQUIREMENTS_STATUS_LABELS[booking.requirementsStatus] ?? formatStatus(booking.requirementsStatus),
      detail: documents.length ? `${documents.length} submitted file${documents.length === 1 ? "" : "s"}` : "No files submitted",
      ready: booking.requirementsStatus === "approved",
    },
    {
      label: "Agreement",
      value: AGREEMENT_STATUS_LABELS[booking.agreementStatus] ?? formatStatus(booking.agreementStatus),
      detail: businessSignature
        ? `Countersigned by ${businessSignature.signerName}`
        : customerSignature
          ? "Customer signed; business countersignature required"
          : "Customer signature pending",
      ready: booking.agreementStatus === "completed",
    },
    {
      label: "Inventory",
      value: booking.inventoryUnitId ? "Reserved" : "Needs Assignment",
      detail: booking.inventoryUnitId || "No unit assigned",
      ready: Boolean(booking.inventoryUnitId),
    },
  ];
  const remainingChecks = reviewChecks.filter((check) => !check.ready).length;
  const bookingMilestones = getBookingMilestones(booking);

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
          <span className={`${styles.liveStatus} ${styles[liveStatus]}`}>
            <span aria-hidden="true" />
            {getBookingLiveStatusLabel(liveStatus)}
          </span>
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

      <section className={styles.reviewOverview} aria-label="Booking review summary">
        <article className={styles.bookingSnapshot}>
          <div className={styles.snapshotTopline}>
            <span>At a glance</span>
            <strong>{formatStatus(booking.status)}</strong>
          </div>
          <h2>{booking.productSnapshot.name}</h2>
          <p className={styles.rentalWindow}>
            {formatDate(booking.startDate)} — {formatDate(booking.endDate)}
            <span>{booking.dayCount} day{booking.dayCount === 1 ? "" : "s"} · {booking.quantity} unit{booking.quantity === 1 ? "" : "s"}</span>
          </p>
          <dl className={styles.snapshotFacts}>
            <div><dt>Customer</dt><dd>{fullName}</dd></div>
            <div><dt>Contact</dt><dd>{phone}<small>{email}</small></dd></div>
            <div><dt>Fulfillment</dt><dd>{formatStatus(booking.fulfillmentMethod)}<small>{getFulfillmentProgressLabel(booking.status, booking.fulfillmentMethod)}</small></dd></div>
            <div><dt>Total</dt><dd>{totalAmount}<small>{paymentStatusLabel}</small></dd></div>
          </dl>
          <div className={styles.snapshotFooter}>
            <span>Created {formatDate(booking.createdAt, true)}</span>
            <Link href={`/admin/users/${booking.customerId}`}>View customer account</Link>
          </div>
        </article>

        <article className={styles.reviewChecklist}>
          <div className={styles.checklistHeader}>
            <div>
              <span>Approval checklist</span>
              <h2>{remainingChecks === 0 ? "All checks complete" : `${remainingChecks} item${remainingChecks === 1 ? "" : "s"} need attention`}</h2>
            </div>
            <span className={remainingChecks === 0 ? styles.readyPill : styles.pendingPill}>
              {remainingChecks === 0 ? "Ready" : "Review needed"}
            </span>
          </div>
          <div className={styles.checkList}>
            {reviewChecks.map((check) => (
              <div key={check.label} className={check.ready ? styles.checkReady : styles.checkPending}>
                <span aria-hidden="true">{check.ready ? "✓" : "!"}</span>
                <div><small>{check.label}</small><strong>{check.value}</strong><p>{check.detail}</p></div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className={styles.actionPanel} aria-labelledby="booking-action-heading">
        <div className={styles.actionIntro}>
          <span>Booking operations</span>
          <h2 id="booking-action-heading">Move the booking forward</h2>
          <p>Select a clear action card below. Every change is recorded, sent to the customer, and reflected automatically on their account.</p>
        </div>
        <ol className={styles.statusJourney} aria-label="Booking status journey">
          {bookingMilestones.map((milestone, index) => (
            <li
              key={milestone.key}
              className={milestone.current ? styles.journeyCurrent : milestone.completed ? styles.journeyComplete : styles.journeyUpcoming}
            >
              <span aria-hidden="true">{milestone.completed && !milestone.current ? "✓" : index + 1}</span>
              <div><strong>{milestone.label}</strong><small>{milestone.current ? "Current status" : milestone.completed ? "Completed" : "Upcoming"}</small></div>
            </li>
          ))}
        </ol>
        {actions.length ? (
          <div className={styles.actionControls}>
            <div className={styles.actionChoiceGrid} aria-label="Available booking actions">
              {actions.map((action) => {
                const selected = action.status === selectedStatus;
                return (
                  <button
                    key={action.status}
                    type="button"
                    className={`${styles.actionChoice} ${action.tone === "danger" ? styles.dangerChoice : ""} ${selected ? styles.actionChoiceSelected : ""}`}
                    onClick={() => { setSelectedStatus(action.status); setNote(""); }}
                    aria-pressed={selected}
                    disabled={updating}
                  >
                    <span className={styles.actionChoiceIcon} aria-hidden="true">{action.tone === "danger" ? "!" : "→"}</span>
                    <span className={styles.actionChoiceCopy}>
                      <small>{action.tone === "danger" ? "Close booking" : "Recommended next step"}</small>
                      <strong>{action.label}</strong>
                      <span>{action.description}</span>
                    </span>
                    <span className={styles.actionChoiceState}>{selected ? "Selected" : "Choose"}</span>
                  </button>
                );
              })}
            </div>
            {selectedAction ? (
              <div className={`${styles.actionConfirmation} ${selectedAction.tone === "danger" ? styles.dangerConfirmation : ""}`}>
                <div>
                  <small>Selected action</small>
                  <h3>{selectedAction.label}</h3>
                  <p>{selectedAction.description}</p>
                </div>
                <label className={styles.noteField}>
                  <span>Message to customer{selectedAction.requiresNote ? " (required)" : " (optional)"}</span>
                  <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000} placeholder={selectedAction.requiresNote ? "Explain the reason clearly before continuing" : "Add a helpful update or handover instruction"} disabled={updating} />
                </label>
                <div className={styles.confirmationActions}>
                  <button type="button" className={styles.cancelSelectionButton} onClick={() => { setSelectedStatus(""); setNote(""); }} disabled={updating}>Choose another action</button>
                  <button type="button" className={`${styles.applyButton} ${selectedAction.tone === "danger" ? styles.dangerButton : ""}`} onClick={requestStatusAction} disabled={updating || (selectedAction.requiresNote && !note.trim())}>
                    {updating ? "Updating customer..." : `Confirm ${selectedAction.label}`}
                  </button>
                </div>
              </div>
            ) : (
              <p className={styles.choosePrompt}>Choose an action card to review its customer message before confirming.</p>
            )}
          </div>
        ) : <p className={styles.terminalNotice}>This booking is complete or closed. No further actions are available.</p>}
      </section>

      <div className={styles.detailSections}>
        <details className={styles.detailSection}>
          <summary>
            <span className={styles.sectionNumber}>01</span>
            <div><strong>Customer &amp; Rental Details</strong><small>Contact, dates, pricing, delivery and accessories</small></div>
            <span className={styles.expandLabel}>View details</span>
          </summary>
          <div className={styles.detailBody}>
            <div className={styles.subsectionHeading}><h3>Customer</h3><Link href={`/admin/users/${booking.customerId}`}>Open full customer profile</Link></div>
            <dl className={styles.detailGrid}>
              <div><dt>Full name</dt><dd>{fullName}</dd></div>
              <div><dt>Email address</dt><dd>{email}</dd></div>
              <div><dt>Phone number</dt><dd>{phone}</dd></div>
              <div className={styles.wideDetail}><dt>Complete address</dt><dd>{address}</dd></div>
              <div><dt>Facebook</dt><dd>{facebook ? <a href={facebook} target="_blank" rel="noopener noreferrer">Open profile</a> : "-"}</dd></div>
              <div><dt>Instagram</dt><dd>{instagram ? <a href={instagram} target="_blank" rel="noopener noreferrer">Open profile</a> : "-"}</dd></div>
            </dl>
            <div className={styles.subsectionHeading}><h3>Rental &amp; Pricing</h3></div>
            <dl className={styles.detailGrid}>
              <div><dt>Rental item</dt><dd>{booking.productSnapshot.name}</dd></div>
              <div><dt>Brand / Category</dt><dd>{booking.productSnapshot.brand} / {booking.productSnapshot.category}</dd></div>
              <div><dt>Rental period</dt><dd>{formatDate(booking.startDate)} — {formatDate(booking.endDate)}</dd></div>
              <div><dt>Duration / Quantity</dt><dd>{booking.dayCount} day(s) · {booking.quantity} unit(s)</dd></div>
              <div><dt>Rental subtotal</dt><dd>PHP {booking.rentalSubtotal.toLocaleString("en-PH")}</dd></div>
              <div><dt>Non-refundable deposit</dt><dd>PHP {booking.refundableDeposit.toLocaleString("en-PH")}</dd></div>
              {booking.birthdayDiscountAmount > 0 ? <div><dt>Birthday perk</dt><dd>-PHP {booking.birthdayDiscountAmount.toLocaleString("en-PH")}</dd></div> : null}
              {booking.loyaltyDiscountAmount > 0 ? <div><dt>11th-rental reward</dt><dd>-PHP {booking.loyaltyDiscountAmount.toLocaleString("en-PH")}</dd></div> : null}
              <div className={styles.emphasizedDetail}><dt>Total amount</dt><dd>{totalAmount}</dd></div>
              <div><dt>Assigned unit</dt><dd>{booking.inventoryUnitId || "Not assigned"}</dd></div>
              <div className={styles.wideDetail}><dt>{formatStatus(booking.fulfillmentMethod)} location</dt><dd>{booking.location || "-"}</dd></div>
              <div className={styles.wideDetail}><dt>Included accessories</dt><dd>{booking.productSnapshot.included?.length ? booking.productSnapshot.included.join(", ") : "None listed"}</dd></div>
            </dl>
          </div>
        </details>

        <details className={styles.detailSection} open={booking.requirementsStatus === "pending_review" || booking.requirementsStatus === "rejected"}>
          <summary>
            <span className={styles.sectionNumber}>02</span>
            <div><strong>Verification Documents</strong><small>{REQUIREMENTS_STATUS_LABELS[booking.requirementsStatus] ?? formatStatus(booking.requirementsStatus)} · {documents.length} file{documents.length === 1 ? "" : "s"}</small></div>
            <span className={styles.expandLabel}>Review files</span>
          </summary>
          <div className={styles.detailBody}>
            {emergencyContact || documents.length ? <>
              {emergencyContact ? <dl className={`${styles.detailGrid} ${styles.emergencyGrid}`}>
                <div><dt>Emergency contact</dt><dd>{emergencyContact.fullName}</dd></div>
                <div><dt>Relationship</dt><dd>{emergencyContact.relationship}</dd></div>
                <div><dt>Emergency phone</dt><dd>{emergencyContact.phoneNumber}</dd></div>
                <div><dt>Address</dt><dd>{emergencyContact.address || "-"}</dd></div>
              </dl> : null}
              <RequirementsReviewPanel
                bookingId={bookingId}
                documents={documents}
                onOpenDocument={(document) => openPrivateFile(
                  document.storageBucket as Parameters<typeof getBookingFileUrl>[1],
                  document.storagePath,
                )}
                onUpdated={loadDetails}
              />
            </> : <p className={styles.empty}>Requirements have not been submitted for this booking.</p>}
          </div>
        </details>

        <details className={styles.detailSection} open={agreement?.status === "awaiting_business_signature"}>
          <summary>
            <span className={styles.sectionNumber}>03</span>
            <div><strong>Agreement &amp; Payment</strong><small>{paymentStatusLabel} · {AGREEMENT_STATUS_LABELS[booking.agreementStatus] ?? formatStatus(booking.agreementStatus)}</small></div>
            <span className={styles.expandLabel}>{agreement?.status === "awaiting_business_signature" ? "Action required" : "View records"}</span>
          </summary>
          <div className={styles.detailBody}>
            <div className={styles.recordsLayout}>
              <article className={styles.recordCard}>
                <div className={styles.recordHeader}>
                  <div><span>RENTAL AGREEMENT</span><h3>Signature workflow</h3></div>
                  <span className={`${styles.recordStatus} ${agreement?.status === "completed" ? styles.recordComplete : styles.recordPending}`}>
                    {AGREEMENT_STATUS_LABELS[booking.agreementStatus] ?? formatStatus(booking.agreementStatus)}
                  </span>
                </div>

                {agreement ? <>
                  <ol className={styles.signatureSteps}>
                    <li className={customerSignature ? styles.stepComplete : styles.stepCurrent}>
                      <span>{customerSignature ? "✓" : "1"}</span>
                      <div><strong>Customer signature</strong><small>{customerSignature ? `${customerSignature.signerName} · ${formatDate(customerSignature.signedAt, true)}` : "Waiting for customer"}</small></div>
                    </li>
                    <li className={businessSignature ? styles.stepComplete : customerSignature ? styles.stepCurrent : styles.stepUpcoming}>
                      <span>{businessSignature ? "✓" : "2"}</span>
                      <div><strong>Business countersignature</strong><small>{businessSignature ? `${businessSignature.signerName} · ${formatDate(businessSignature.signedAt, true)}` : customerSignature ? "Admin reviews and countersigns" : "Available after customer signs"}</small></div>
                    </li>
                    <li className={agreement.finalDocumentPath ? styles.stepComplete : styles.stepUpcoming}>
                      <span>{agreement.finalDocumentPath ? "✓" : "3"}</span>
                      <div><strong>Final agreement PDF</strong><small>{agreement.finalDocumentPath ? "Ready for admin and customer" : "Created after both signatures"}</small></div>
                    </li>
                  </ol>

                  {agreement.status === "awaiting_business_signature" ? (
                    <div className={styles.countersignPanel}>
                      <div className={styles.countersignIntro}>
                        <span>ADMIN ACTION REQUIRED</span>
                        <h4>Review, countersign, and finalize</h4>
                        <p>The customer has completed their part. Verify the payment and all required documents, then enter the authorized business signer&apos;s name.</p>
                      </div>
                      <div className={styles.readinessChecks}>
                        <span className={amountPaid > 0 ? styles.ready : styles.notReady}>{amountPaid > 0 ? "✓" : "!"} Payment verified</span>
                        <span className={booking.requirementsStatus === "approved" ? styles.ready : styles.notReady}>{booking.requirementsStatus === "approved" ? "✓" : "!"} Documents approved</span>
                        <span className={customerSignature ? styles.ready : styles.notReady}>{customerSignature ? "✓" : "!"} Customer signed</span>
                      </div>
                      {!canCountersignAgreement ? (
                        <p className={styles.blockedMessage}>Complete every check above before the business countersignature becomes available.</p>
                      ) : null}
                      <label className={styles.signerField}>
                        <span>Authorized business signer&apos;s complete name</span>
                        <input
                          value={businessSignerName}
                          onChange={(event) => setBusinessSignerName(event.target.value)}
                          maxLength={120}
                          placeholder="Enter the person signing for Maddy & Cassy"
                          disabled={!canCountersignAgreement || countersigning}
                        />
                      </label>
                      <label className={styles.authorizationCheck}>
                        <input
                          type="checkbox"
                          checked={countersignAcknowledged}
                          onChange={(event) => setCountersignAcknowledged(event.target.checked)}
                          disabled={!canCountersignAgreement || countersigning}
                        />
                        <span>I confirm that I am authorized to countersign this rental agreement for Rental by Maddy &amp; Cassy.</span>
                      </label>
                      <button
                        type="button"
                        className={styles.countersignButton}
                        onClick={handleCountersignAgreement}
                        disabled={!canCountersignAgreement || !businessSignerName.trim() || !countersignAcknowledged || countersigning}
                      >
                        {countersigning ? "Finalizing agreement..." : "Countersign & Finalize Agreement"}
                      </button>
                      <small className={styles.legalNote}>This records the administrator, signer name, timestamp, IP address, and finalized PDF in the audit trail.</small>
                    </div>
                  ) : null}

                  {agreement.status === "completed" ? (
                    <div className={styles.completedAgreement}>
                      <div><span aria-hidden="true">✓</span><div><strong>Agreement fully signed</strong><p>No further signature action is needed. The customer can access the final PDF from My Bookings.</p></div></div>
                      {booking.status === "approved" ? <p className={styles.nextAdminStep}><strong>Next admin step:</strong> Use “Update this booking” above and choose “Confirm Booking.” The customer will then receive the final booking confirmation.</p> : null}
                      {booking.status === "pending" ? <p className={styles.nextAdminStep}><strong>Next admin step:</strong> Approve the booking first, then confirm it after every checklist item is complete.</p> : null}
                      <div className={styles.agreementButtons}>
                        {agreement.finalDocumentPath ? <button type="button" onClick={() => openPrivateFile("agreements", agreement.finalDocumentPath!)}>Open final agreement</button> : null}
                        {customerSignature?.signaturePath ? <button type="button" className={styles.secondaryRecordButton} onClick={() => openPrivateFile("customer-documents", customerSignature.signaturePath!)}>View customer signature</button> : null}
                      </div>
                    </div>
                  ) : null}
                </> : <p className={styles.emptyRecord}>The customer has not submitted a rental agreement yet.</p>}
              </article>

              <article className={styles.recordCard}>
                <div className={styles.recordHeader}>
                  <div><span>PAYMENT RECORDS</span><h3>Verified transactions</h3></div>
                  <span className={`${styles.recordStatus} ${amountPaid > 0 ? styles.recordComplete : styles.recordPending}`}>{paymentStatusLabel}</span>
                </div>
                <div className={styles.paymentAmount}>
                  <span>Verified amount</span>
                  <strong>PHP {amountPaid.toLocaleString("en-PH")}</strong>
                  <small>of PHP {booking.totalAmount.toLocaleString("en-PH")} booking total</small>
                </div>
                <dl className={styles.paymentFacts}>
                  <div><dt>Attempts</dt><dd>{payments.length}</dd></div>
                  <div><dt>Receipts</dt><dd>{receipts.length}</dd></div>
                  <div><dt>Balance</dt><dd>PHP {Math.max(0, booking.totalAmount - amountPaid).toLocaleString("en-PH")}</dd></div>
                </dl>
                {receipts.some((receipt) => receipt.documentPath) ? (
                  <div className={styles.receiptList}>
                    {receipts.filter((receipt) => receipt.documentPath).map((receipt) => (
                      <button key={receipt.id} type="button" onClick={() => openPrivateFile("receipts", receipt.documentPath!)}>
                        <span className={styles.receiptIcon}>PDF</span>
                        <span><strong>{receipt.receiptNumber ?? receipt.id.slice(0, 8)}</strong><small>Open official receipt</small></span>
                        <span aria-hidden="true">↗</span>
                      </button>
                    ))}
                  </div>
                ) : <p className={styles.emptyRecord}>No customer-facing receipt has been issued yet.</p>}
                <PaymentsReviewPanel
                  bookingId={bookingId}
                  payments={payments}
                  onOpenProof={(payment: PaymentRecord) => {
                    if (payment.proofStorageBucket && payment.proofStoragePath) {
                      openPrivateFile(
                        payment.proofStorageBucket as Parameters<typeof getBookingFileUrl>[1],
                        payment.proofStoragePath,
                      );
                    }
                  }}
                  onUpdated={loadDetails}
                />
              </article>
            </div>
          </div>
        </details>

        <details className={styles.detailSection}>
          <summary>
            <span className={styles.sectionNumber}>04</span>
            <div><strong>Status Activity</strong><small>{statusHistory.length} recorded update{statusHistory.length === 1 ? "" : "s"}</small></div>
            <span className={styles.expandLabel}>View timeline</span>
          </summary>
          <div className={styles.detailBody}>
            {statusHistory.length ? <ol className={styles.timeline}>{statusHistory.map((entry) => <li key={entry.id}><span aria-hidden="true" /><div><strong>{entry.fromStatus ? `${formatStatus(entry.fromStatus)} to ` : ""}{formatStatus(entry.toStatus)}</strong><p>{entry.note || "Status updated."}</p><small>{formatDate(entry.createdAt, true)}</small></div></li>)}</ol> : <p className={styles.empty}>No status history is available.</p>}
          </div>
        </details>
      </div>

      {statusConfirmationOpen && selectedAction ? (
        <div
          className={styles.confirmationOverlay}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !updating) setStatusConfirmationOpen(false);
          }}
        >
          <div
            ref={confirmationDialogRef}
            className={`${styles.confirmationDialog} ${selectedAction.tone === "danger" ? styles.confirmationDialogDanger : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="status-confirmation-title"
            aria-describedby="status-confirmation-description"
            tabIndex={-1}
          >
            <div className={styles.confirmationBrand}>
              <Image src="/images/maddy-cassy-rentals-logo.png" alt="" width={48} height={48} />
              <div><span>RENTAL BY</span><strong>Maddy &amp; Cassy</strong></div>
            </div>
            <div className={styles.confirmationIcon} aria-hidden="true">{selectedAction.tone === "danger" ? "!" : "✓"}</div>
            <div className={styles.confirmationCopy}>
              <span>Confirm booking update</span>
              <h2 id="status-confirmation-title">{selectedAction.label}</h2>
              <p id="status-confirmation-description">Apply this update to booking <strong>{booking.bookingRef}</strong>?</p>
              <div className={styles.confirmationSummary}>
                <strong>{selectedAction.description}</strong>
                <span>The customer&apos;s account and booking timeline will update immediately.</span>
              </div>
            </div>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogCancelButton} onClick={() => setStatusConfirmationOpen(false)} disabled={updating}>Not yet</button>
              <button type="button" className={`${styles.dialogConfirmButton} ${selectedAction.tone === "danger" ? styles.dialogDangerButton : ""}`} onClick={() => void confirmStatusAction()} disabled={updating}>
                {updating ? "Updating booking..." : `Yes, ${selectedAction.label}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
