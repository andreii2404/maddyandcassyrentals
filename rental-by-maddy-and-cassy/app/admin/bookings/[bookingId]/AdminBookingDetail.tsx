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
import { getBookingPayments, getBookingReceipts, sendBookingReceiptEmail } from "@/src/services/paymentService";
import type { BookingStatus, UserProfile } from "@/src/types/database";
import type { BookingDocument, RequirementReviewStatus, RequirementsStatus } from "@/src/types/booking";
import type { PaymentRecord, BookingReceipt } from "@/src/types/payment";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "@/components/status-badge/StatusBadge";
import GuestBadge from "@/components/status-badge/GuestBadge";
import { useToast } from "@/components/ui/ToastProvider";
import {
  getBookingLiveStatusLabel,
  useBookingRealtime,
} from "@/hooks/useBookingRealtime";
import styles from "./bookingDetail.module.css";
import RequirementsReviewPanel from "@/components/admin/RequirementsReviewPanel";
import PaymentsReviewPanel from "@/components/admin/PaymentsReviewPanel";
import {
  DECLINE_REASON_OPTIONS,
  formatDeclineNote,
  getBookingMilestones,
  getFulfillmentProgressLabel,
} from "@/src/lib/bookingManagement";
import BookingItemsSummary from "@/components/booking-summary/BookingItemsSummary";
import { bookingHeadline, bookingItemsSummaryData } from "@/src/lib/bookingDisplay";

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

type AdminReviewWorkspace =
  | "decision"
  | "booking"
  | "payment"
  | "documents"
  | "agreement"
  | "activity";

export default function AdminBookingDetail({ bookingId }: { bookingId: string }) {
  const { showToast } = useToast();
  const [state, setState] = useState<DetailState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<"" | BookingStatus>("");
  const [note, setNote] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [updating, setUpdating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [businessSignerName, setBusinessSignerName] = useState("");
  const [countersignAcknowledged, setCountersignAcknowledged] = useState(false);
  const [countersigning, setCountersigning] = useState(false);
  const [statusConfirmationOpen, setStatusConfirmationOpen] = useState(false);
  const [countersignConfirmationOpen, setCountersignConfirmationOpen] = useState(false);
  const [sendingReceiptId, setSendingReceiptId] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<AdminReviewWorkspace>("decision");
  const confirmationDialogRef = useRef<HTMLDivElement>(null);
  const countersignDialogRef = useRef<HTMLDivElement>(null);

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
  const isDeclineAction = selectedAction?.status === "rejected";
  const declineIncomplete = isDeclineAction && (!declineReason || note.trim().length < 5);

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

  useEffect(() => {
    if (!countersignConfirmationOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    countersignDialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !countersigning) setCountersignConfirmationOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [countersignConfirmationOpen, countersigning]);

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

  function handleDocumentReviewed(
    documentId: string,
    patch: { reviewStatus: Exclude<RequirementReviewStatus, "pending">; reviewNotes?: string },
    requirementsStatus: RequirementsStatus,
  ) {
    setState((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        details: {
          ...previous.details,
          booking: { ...previous.details.booking, requirementsStatus },
          documents: previous.details.documents.map((document): BookingDocument =>
            document.id === documentId ? { ...document, ...patch } : document,
          ),
        },
      };
    });
  }

  async function handleSendReceiptEmail(receipt: BookingReceipt) {
    setSendingReceiptId(receipt.id);
    try {
      const result = await sendBookingReceiptEmail(bookingId, receipt.id);
      await loadDetails();
      showToast(`Receipt sent to ${result.emailedTo}.`, "success");
    } catch (sendError) {
      showToast(
        sendError instanceof Error ? sendError.message : "The receipt email could not be sent.",
        "error",
      );
    } finally {
      setSendingReceiptId(null);
    }
  }

  function requestStatusAction() {
    if (!state || !selectedStatus || !selectedAction) return;
    if (isDeclineAction) {
      if (!declineReason) {
        showToast("Select a decline reason before continuing.", "error");
        return;
      }
      if (note.trim().length < 5) {
        showToast("Add a short explanation of what was found before continuing.", "error");
        return;
      }
    } else if (selectedAction.requiresNote && !note.trim()) {
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
        setDeclineReason("");
        return;
      }

      const noteToSend = isDeclineAction ? formatDeclineNote(declineReason, note) : note;
      const updateResult = await updateAdminBookingStatus(bookingId, selectedStatus, noteToSend);
      await loadDetails();
      setStatusConfirmationOpen(false);
      setSelectedStatus("");
      setNote("");
      setDeclineReason("");
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

  function requestCountersignAgreement() {
    if (!businessSignerName.trim()) {
      showToast("Enter the authorized business signer's complete name.", "error");
      return;
    }
    if (!countersignAcknowledged) {
      showToast("Confirm that you are authorized to countersign for the business.", "error");
      return;
    }
    setCountersignConfirmationOpen(true);
  }

  async function confirmCountersignAgreement() {
    setCountersigning(true);
    try {
      await countersignBookingAgreement(bookingId, businessSignerName.trim());
      await loadDetails();
      setCountersignAcknowledged(false);
      setCountersignConfirmationOpen(false);
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
  // customerSnapshot is assembled straight from the customer's profile row
  // (see assembleBooking in bookingService.ts) -- for a guest checkout that's
  // the anonymous session's profile, updated with the guest's own entered
  // name/email/phone by save_guest_checkout_contact. Only fall back to the
  // "Guest" placeholder if that profile truly has no name on file.
  const fullName = customer?.fullName || profile?.displayName || "Guest";
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
  const handoverPaymentReady = amountPaid >= booking.totalAmount - 0.01 || booking.payLaterAllowed;
  const canCountersignAgreement = Boolean(
    agreement?.status === "awaiting_business_signature" &&
    customerSignature &&
    amountPaid > 0 &&
    booking.requirementsStatus === "approved",
  );
  const totalUnits = booking.items.reduce((sum, item) => sum + item.quantity, 0);
  const totalAssignedUnits = booking.items.reduce((sum, item) => sum + item.assignedUnitCount, 0);
  const inventoryReady = booking.items.length > 0 && booking.items.every((item) => item.assignedUnitCount >= item.quantity);
  const itemsSummary = bookingItemsSummaryData(booking, agreement);
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
      value: inventoryReady ? "Reserved" : "Needs Assignment",
      detail: `${totalAssignedUnits}/${totalUnits} unit(s) reserved`,
      ready: inventoryReady,
    },
  ];
  const remainingChecks = reviewChecks.filter((check) => !check.ready).length;
  const bookingMilestones = getBookingMilestones(booking);
  const primaryAction = actions.find((action) => action.tone !== "danger") ?? null;

  function jumpToNextStep() {
    setActiveWorkspace("decision");
    if (primaryAction) {
      setSelectedStatus(primaryAction.status);
      setNote("");
    }
    window.setTimeout(() => {
      document.getElementById("admin-workspace-nav")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  return (
    <div className={styles.page}>
      <Link href="/admin/bookings" className={styles.backLink}>Back to Bookings</Link>

      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>BOOKING REVIEW</p>
          <h1>{booking.bookingRef}</h1>
          <p>{bookingHeadline(booking.items)} for {fullName}</p>
        </div>
        <div className={styles.headerActions}>
          <span className={`${styles.liveStatus} ${styles[liveStatus]}`}>
            <span aria-hidden="true" />
            {getBookingLiveStatusLabel(liveStatus)}
          </span>
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

      <div className={styles.reviewOverview}>
      <section className={styles.statusHero} aria-label="Current status and recommended next step">
        <div className={styles.statusHeroBlock}>
          <span>Current status</span>
          <div className={styles.statusHeroBadge}><StatusBadge status={booking.status} /></div>
        </div>
        <div className={styles.statusHeroDivider} aria-hidden="true" />
        <div className={`${styles.statusHeroBlock} ${styles.statusHeroBlockGrow}`}>
          <span>Recommended next step</span>
          {primaryAction ? (
            <>
              <strong>{primaryAction.label}</strong>
              <p>{primaryAction.description}</p>
            </>
          ) : (
            <>
              <strong>No further action needed</strong>
              <p>This booking is complete or closed.</p>
            </>
          )}
        </div>
        {primaryAction ? (
          <button type="button" className={styles.statusHeroButton} onClick={jumpToNextStep}>
            Review &amp; apply
          </button>
        ) : null}
      </section>

      <section className={styles.bookingSummarySection} aria-label="Booking summary">
        <article className={styles.bookingSnapshot}>
          <div className={styles.snapshotTopline}>
            <span>Booking summary</span>
          </div>
          <h2>{bookingHeadline(booking.items)}</h2>
          <p className={styles.rentalWindow}>
            {formatDate(booking.startDate)} — {formatDate(booking.endDate)}
            <span>{booking.dayCount} day{booking.dayCount === 1 ? "" : "s"} · {totalUnits} unit{totalUnits === 1 ? "" : "s"}</span>
          </p>
          <dl className={styles.snapshotFacts}>
            <div>
              <dt>Customer</dt>
              <dd className={styles.customerNameRow}>
                {fullName}
                {booking.isGuestCheckout ? <GuestBadge /> : null}
              </dd>
            </div>
            <div><dt>Contact</dt><dd>{phone}<small>{email}</small></dd></div>
            <div><dt>Fulfillment</dt><dd>{formatStatus(booking.fulfillmentMethod)}<small>{getFulfillmentProgressLabel(booking.status, booking.fulfillmentMethod)}</small></dd></div>
            <div><dt>Total</dt><dd>{totalAmount}<small>{paymentStatusLabel}</small></dd></div>
          </dl>
          <div className={styles.snapshotFooter}>
            <span>Created {formatDate(booking.createdAt, true)}</span>
            <Link href={`/admin/users/${booking.customerId}`}>View customer account</Link>
          </div>
        </article>
      </section>
      </div>

      <section className={styles.reviewReadiness} aria-labelledby="review-readiness-heading">
        <div className={styles.reviewReadinessHeading}>
          <div>
            <span>REVIEW READINESS</span>
            <h2 id="review-readiness-heading">What is ready and what needs attention</h2>
          </div>
          <span className={remainingChecks === 0 ? styles.readyPill : styles.pendingPill}>
            {remainingChecks === 0 ? "Ready for the next action" : `${remainingChecks} check${remainingChecks === 1 ? "" : "s"} remaining`}
          </span>
        </div>
        <div className={styles.checklistChips}>
          {reviewChecks.map((check) => (
            <button
              key={check.label}
              type="button"
              className={check.ready ? styles.checkChipReady : styles.checkChipPending}
              onClick={() => setActiveWorkspace(
                check.label === "Payment"
                  ? "payment"
                  : check.label === "Verification"
                    ? "documents"
                    : check.label === "Agreement"
                      ? "agreement"
                      : "booking",
              )}
              title={check.detail}
            >
              <span aria-hidden="true">{check.ready ? "✓" : "!"}</span>
              <div><small>{check.label}</small><strong>{check.value}</strong><em>{check.detail}</em></div>
            </button>
          ))}
        </div>
      </section>

      <nav id="admin-workspace-nav" className={styles.workspaceNav} aria-label="Admin booking review sections" role="tablist">
        <button type="button" role="tab" aria-selected={activeWorkspace === "decision"} onClick={() => setActiveWorkspace("decision")}>
          <span>01</span><strong>Decision</strong><small>{primaryAction?.label ?? "Closed"}</small>
        </button>
        <button type="button" role="tab" aria-selected={activeWorkspace === "booking"} onClick={() => setActiveWorkspace("booking")}>
          <span>02</span><strong>Booking</strong><small>Customer &amp; rental</small>
        </button>
        <button type="button" role="tab" aria-selected={activeWorkspace === "payment"} onClick={() => setActiveWorkspace("payment")}>
          <span>03</span><strong>Payment</strong><small>{paymentStatusLabel}</small>
        </button>
        <button type="button" role="tab" aria-selected={activeWorkspace === "documents"} onClick={() => setActiveWorkspace("documents")}>
          <span>04</span><strong>Documents</strong><small>{REQUIREMENTS_STATUS_LABELS[booking.requirementsStatus] ?? formatStatus(booking.requirementsStatus)}</small>
        </button>
        <button type="button" role="tab" aria-selected={activeWorkspace === "agreement"} onClick={() => setActiveWorkspace("agreement")}>
          <span>05</span><strong>Agreement</strong><small>{AGREEMENT_STATUS_LABELS[booking.agreementStatus] ?? formatStatus(booking.agreementStatus)}</small>
        </button>
        <button type="button" role="tab" aria-selected={activeWorkspace === "activity"} onClick={() => setActiveWorkspace("activity")}>
          <span>06</span><strong>Activity</strong><small>{statusHistory.length} updates</small>
        </button>
      </nav>

      <section id="admin-actions" className={styles.actionPanel} aria-labelledby="booking-action-heading" hidden={activeWorkspace !== "decision"}>
        <div className={styles.actionIntro}>
          <span>ADMIN DECISION</span>
          <h2 id="booking-action-heading">Review and apply the next action</h2>
          <p>Choose one valid action for the booking&apos;s current stage. Every change is recorded in the audit trail, reflected on the customer tracker, and eligible updates notify the customer automatically.</p>
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
                const blockedByBalance = action.status === "released" && !handoverPaymentReady;
                return (
                  <button
                    key={action.status}
                    type="button"
                    className={`${styles.actionChoice} ${action.tone === "danger" ? styles.dangerChoice : ""} ${selected ? styles.actionChoiceSelected : ""}`}
                    onClick={() => { setSelectedStatus(action.status); setNote(""); setDeclineReason(""); }}
                    aria-pressed={selected}
                    disabled={updating || blockedByBalance}
                  >
                    <span className={styles.actionChoiceIcon} aria-hidden="true">{action.tone === "danger" ? "!" : "→"}</span>
                    <span className={styles.actionChoiceCopy}>
                      <small>{action.tone === "danger" ? "Close booking" : action.status === primaryAction?.status ? "Recommended next step" : "Alternative action"}</small>
                      <strong>{action.label}</strong>
                      <span>{blockedByBalance ? "Record the remaining balance or approve a pay-later exception in Agreement & Payment first." : action.description}</span>
                    </span>
                    <span className={styles.actionChoiceState}>{selected ? "Selected" : "Choose"}</span>
                  </button>
                );
            })}
          </div>
            {actions.some((action) => action.status === "released") && !handoverPaymentReady ? (
              <p className={styles.choosePrompt}>Handover is protected: the remaining balance must be recorded before “Released to Customer” becomes available.</p>
            ) : null}
            {selectedAction ? (
              <div className={`${styles.actionConfirmation} ${selectedAction.tone === "danger" ? styles.dangerConfirmation : ""}`}>
                <div>
                  <small>Selected action</small>
                  <h3>{selectedAction.label}</h3>
                  <p>{selectedAction.description}</p>
                </div>
                {isDeclineAction ? (
                  <>
                    <label className={styles.noteField}>
                      <span>Decline reason (required)</span>
                      <select value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} disabled={updating}>
                        <option value="" disabled>Select a reason</option>
                        {DECLINE_REASON_OPTIONS.map((reason) => (
                          <option key={reason} value={reason}>{reason}</option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.noteField}>
                      <span>Explanation for the customer (required)</span>
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={3}
                        maxLength={1000}
                        placeholder="Describe exactly what was found and what the customer needs to know"
                        disabled={updating}
                      />
                    </label>
                  </>
                ) : (
                  <label className={styles.noteField}>
                    <span>Message to customer{selectedAction.requiresNote ? " (required)" : " (optional)"}</span>
                    <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000} placeholder={selectedAction.requiresNote ? "Explain the reason clearly before continuing" : "Add a helpful update or handover instruction"} disabled={updating} />
                  </label>
                )}
                <div className={styles.confirmationActions}>
                  <button type="button" className={styles.cancelSelectionButton} onClick={() => { setSelectedStatus(""); setNote(""); setDeclineReason(""); }} disabled={updating}>Choose another action</button>
                  <button
                    type="button"
                    className={`${styles.applyButton} ${selectedAction.tone === "danger" ? styles.dangerButton : ""}`}
                    onClick={requestStatusAction}
                    disabled={updating || (isDeclineAction ? declineIncomplete : (selectedAction.requiresNote && !note.trim()))}
                  >
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
        <section className={styles.detailSection} role="tabpanel" hidden={activeWorkspace !== "booking"}>
          <div className={styles.detailSectionHeader}>
            <span className={styles.sectionNumber}>01</span>
            <div><strong>Customer Details</strong><small>Contact information and social links</small></div>
            <Link href={`/admin/users/${booking.customerId}`} className={styles.sectionHeaderAction}>Open customer profile</Link>
          </div>
          <div className={styles.detailBody}>
            <div className={styles.subsectionHeading}>
              <h3 className={styles.customerNameRow}>
                Customer contact record{booking.isGuestCheckout ? <GuestBadge /> : null}
              </h3>
            </div>
            <dl className={styles.detailGrid}>
              <div><dt>Full name</dt><dd>{fullName}</dd></div>
              <div><dt>Email address</dt><dd>{email}</dd></div>
              <div><dt>Phone number</dt><dd>{phone}</dd></div>
              <div className={styles.wideDetail}><dt>Complete address</dt><dd>{address}</dd></div>
              <div><dt>Facebook</dt><dd>{facebook ? <a href={facebook} target="_blank" rel="noopener noreferrer">Open profile</a> : "-"}</dd></div>
              <div><dt>Instagram</dt><dd>{instagram ? <a href={instagram} target="_blank" rel="noopener noreferrer">Open profile</a> : "-"}</dd></div>
            </dl>
          </div>
        </section>

        <section className={styles.detailSection} role="tabpanel" hidden={activeWorkspace !== "booking"}>
          <div className={styles.detailSectionHeader}>
            <span className={styles.sectionNumber}>02</span>
            <div><strong>Rental Details</strong><small>Dates, handover, items and pricing</small></div>
            <span className={styles.sectionHeaderStatus}>{totalUnits} unit{totalUnits === 1 ? "" : "s"}</span>
          </div>
          <div className={styles.detailBody}>
            <dl className={styles.detailGrid}>
              <div><dt>Rental period</dt><dd>{formatDate(booking.startDate)} — {formatDate(booking.endDate)}</dd></div>
              <div><dt>Duration</dt><dd>{booking.dayCount} day(s)</dd></div>
              <div><dt>Handover</dt><dd>{formatStatus(booking.fulfillmentMethod)}</dd></div>
              <div className={styles.wideDetail}><dt>{formatStatus(booking.fulfillmentMethod)} location</dt><dd>{booking.location || "-"}</dd></div>
            </dl>
            <BookingItemsSummary
              currency="PHP"
              items={itemsSummary.items}
              unitsExpected={itemsSummary.unitsExpected}
              subtotal={booking.rentalSubtotal}
              discountAmount={booking.specialDiscountAmount}
              depositAmount={booking.refundableDeposit}
              fees={booking.deliveryFee + (booking.pickupConvenienceFee ?? 0)}
              grandTotal={booking.totalAmount}
            />
          </div>
        </section>

        <section className={styles.detailSection} role="tabpanel" hidden={activeWorkspace !== "payment"}>
          <div className={styles.detailSectionHeader}>
            <span className={styles.sectionNumber}>03</span>
            <div><strong>Payment Status</strong><small>{paymentStatusLabel} · {payments.length} attempt{payments.length === 1 ? "" : "s"}</small></div>
            <span className={`${styles.sectionHeaderStatus} ${amountPaid > 0 ? styles.sectionHeaderReady : ""}`}>{paymentStatusLabel}</span>
          </div>
          <div className={styles.detailBody}>
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
                  {receipts.filter((receipt) => receipt.documentPath).map((receipt) => {
                    const linkedPayment = receipt.paymentSubmissionId
                      ? payments.find((p) => p.id === receipt.paymentSubmissionId)
                      : undefined;
                    const paymentVerified = linkedPayment ? linkedPayment.status === "verified" : amountPaid > 0;
                    const sending = sendingReceiptId === receipt.id;
                    return (
                      <div key={receipt.id} className={styles.receiptRow}>
                        <button type="button" onClick={() => openPrivateFile("receipts", receipt.documentPath!)}>
                          <span className={styles.receiptIcon}>PDF</span>
                          <span><strong>{receipt.receiptNumber ?? receipt.id.slice(0, 8)}</strong><small>Open official receipt</small></span>
                          <span aria-hidden="true">↗</span>
                        </button>
                        <div className={styles.receiptEmailAction}>
                          <button
                            type="button"
                            className={styles.sendReceiptButton}
                            disabled={!paymentVerified || sending}
                            onClick={() => handleSendReceiptEmail(receipt)}
                            title={paymentVerified ? "Email the official receipt to the customer" : "Payment must be verified before the receipt can be emailed"}
                          >
                            {sending ? "Sending..." : "Send Receipt to Email"}
                          </button>
                          {receipt.emailedAt ? (
                            <span className={styles.receiptSentBadge}>
                              Receipt sent {formatDate(receipt.emailedAt, true)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <p className={styles.emptyRecord}>No customer-facing receipt has been issued yet.</p>}
              <PaymentsReviewPanel
                bookingId={bookingId}
                booking={booking}
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
        </section>

        <section className={styles.detailSection} role="tabpanel" hidden={activeWorkspace !== "documents"}>
          <div className={styles.detailSectionHeader}>
            <span className={styles.sectionNumber}>04</span>
            <div><strong>Verification Documents</strong><small>{REQUIREMENTS_STATUS_LABELS[booking.requirementsStatus] ?? formatStatus(booking.requirementsStatus)} · {documents.length} file{documents.length === 1 ? "" : "s"}</small></div>
            <span className={`${styles.sectionHeaderStatus} ${booking.requirementsStatus === "approved" ? styles.sectionHeaderReady : ""}`}>{REQUIREMENTS_STATUS_LABELS[booking.requirementsStatus] ?? formatStatus(booking.requirementsStatus)}</span>
          </div>
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
                onReviewed={handleDocumentReviewed}
              />
            </> : <p className={styles.empty}>Requirements have not been submitted for this booking.</p>}
          </div>
        </section>

        <section className={styles.detailSection} role="tabpanel" hidden={activeWorkspace !== "agreement"}>
          <div className={styles.detailSectionHeader}>
            <span className={styles.sectionNumber}>05</span>
            <div><strong>Rental Agreement</strong><small>{AGREEMENT_STATUS_LABELS[booking.agreementStatus] ?? formatStatus(booking.agreementStatus)}</small></div>
            <span className={`${styles.sectionHeaderStatus} ${agreement?.status === "completed" ? styles.sectionHeaderReady : ""}`}>{agreement?.status === "awaiting_business_signature" ? "Action required" : AGREEMENT_STATUS_LABELS[booking.agreementStatus] ?? formatStatus(booking.agreementStatus)}</span>
          </div>
          <div className={styles.detailBody}>
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
                        onClick={requestCountersignAgreement}
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
          </div>
        </section>

        <section className={styles.detailSection} role="tabpanel" hidden={activeWorkspace !== "activity"}>
          <div className={styles.detailSectionHeader}>
            <span className={styles.sectionNumber}>06</span>
            <div><strong>Status Activity</strong><small>{statusHistory.length} recorded update{statusHistory.length === 1 ? "" : "s"}</small></div>
            <span className={styles.sectionHeaderStatus}>Audit trail</span>
          </div>
          <div className={styles.detailBody}>
            {statusHistory.length ? <ol className={styles.timeline}>{statusHistory.map((entry) => <li key={entry.id}><span aria-hidden="true" /><div><strong>{entry.fromStatus ? `${formatStatus(entry.fromStatus)} to ` : ""}{formatStatus(entry.toStatus)}</strong><p>{entry.note || "Status updated."}</p><small>{formatDate(entry.createdAt, true)}</small></div></li>)}</ol> : <p className={styles.empty}>No status history is available.</p>}
          </div>
        </section>
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
                {isDeclineAction ? (
                  <>
                    <span><strong>Reason:</strong> {declineReason}</span>
                    <span><strong>Explanation shown to customer:</strong> {note.trim()}</span>
                  </>
                ) : null}
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

      {countersignConfirmationOpen ? (
        <div
          className={styles.confirmationOverlay}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !countersigning) setCountersignConfirmationOpen(false);
          }}
        >
          <div
            ref={countersignDialogRef}
            className={`${styles.confirmationDialog} ${styles.confirmationDialogDanger}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="countersign-confirmation-title"
            aria-describedby="countersign-confirmation-description"
            tabIndex={-1}
          >
            <div className={styles.confirmationBrand}>
              <Image src="/images/maddy-cassy-rentals-logo.png" alt="" width={48} height={48} />
              <div><span>RENTAL BY</span><strong>Maddy &amp; Cassy</strong></div>
            </div>
            <div className={styles.confirmationIcon} aria-hidden="true">!</div>
            <div className={styles.confirmationCopy}>
              <span>Confirm agreement finalization</span>
              <h2 id="countersign-confirmation-title">Countersign &amp; Finalize Agreement</h2>
              <p id="countersign-confirmation-description">Are you sure you want to countersign and finalize this rental agreement?</p>
              <div className={styles.confirmationSummary}>
                <strong>Signing as {businessSignerName.trim()}</strong>
                <span>This action is permanent and cannot be undone. The final PDF will be generated and made available to the customer immediately.</span>
              </div>
            </div>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogCancelButton} onClick={() => setCountersignConfirmationOpen(false)} disabled={countersigning}>Cancel</button>
              <button type="button" className={`${styles.dialogConfirmButton} ${styles.dialogDangerButton}`} onClick={() => void confirmCountersignAgreement()} disabled={countersigning}>
                {countersigning ? "Finalizing agreement..." : "Yes, Finalize Agreement"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
