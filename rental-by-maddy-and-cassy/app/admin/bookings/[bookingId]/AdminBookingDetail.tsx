"use client";

import { Button } from "@/components/ui/Button";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/src/lib/supabase/client";
import {
  getBookingDetails,
  getBookingFileUrl,
  type BookingDetails,
} from "@/src/services/bookingDetailService";
import {
  ADMIN_BOOKING_ACTIONS,
  autoRejectBookingForMissingRequirements,
  countersignBookingAgreement,
  downloadAdminBookingPdf,
  reviewAdminCancellationRequest,
  sendAdminBookingConfirmationEmail,
  updateAdminBookingStatus,
} from "@/src/services/adminBookingService";
import { getUserProfile } from "@/src/services/userService";
import { getBookingPayments, getBookingReceipts } from "@/src/services/paymentService";
import type { BookingStatus, UserProfile } from "@/src/types/database";
import type { BookingDocument, RequirementReviewStatus, RequirementsStatus } from "@/src/types/booking";
import type { PaymentRecord, BookingReceipt } from "@/src/types/payment";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "@/components/status-badge/StatusBadge";
import GuestBadge from "@/components/status-badge/GuestBadge";
import { useToast } from "@/components/ui/ToastProvider";
import { useBookingRealtime } from "@/hooks/useBookingRealtime";
import styles from "./bookingDetail.module.css";
import RequirementsReviewPanel from "@/components/admin/RequirementsReviewPanel";
import PaymentsReviewPanel from "@/components/admin/PaymentsReviewPanel";
import {
  AUTO_REJECT_DECLINE_DETAILS,
  DECLINE_REASON_OPTIONS,
  formatDeclineNote,
  getFulfillmentProgressLabel,
  getRejectionReason,
  PAYMENT_PROOF_SUBMITTED_STATUSES,
  shouldAutoRejectForMissingRequirements,
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

type AdminReviewStep =
  | "customer"
  | "rental"
  | "requirements"
  | "payment"
  | "agreement"
  | "final"
  | "history";

type ReviewState = "complete" | "pending" | "attention" | "not-started";

const REVIEW_STEPS: { id: AdminReviewStep; label: string }[] = [
  { id: "customer", label: "Customer Information" },
  { id: "rental", label: "Rental Details" },
  { id: "requirements", label: "Requirements" },
  { id: "payment", label: "Payment & Documents" },
  { id: "agreement", label: "Rental Agreement" },
  { id: "final", label: "Final Review" },
  { id: "history", label: "Status History" },
];

// Booking statuses where the admin review has reached its final decision stage.
const FINAL_REVIEW_STATUSES: BookingStatus[] = [
  "confirmed",
  "ready_for_release",
  "released",
  "returned",
];

export default function AdminBookingDetail({ bookingId }: { bookingId: string }) {
  const { showToast } = useToast();
  const [state, setState] = useState<DetailState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<"" | BookingStatus>("");
  const [note, setNote] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [updating, setUpdating] = useState(false);
  const [cancellationDecision, setCancellationDecision] = useState<"approved" | "rejected" | "">("");
  const [cancellationNote, setCancellationNote] = useState("");
  const [reviewingCancellation, setReviewingCancellation] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [businessSignerName, setBusinessSignerName] = useState("");
  const [countersignAcknowledged, setCountersignAcknowledged] = useState(false);
  const [countersigning, setCountersigning] = useState(false);
  const [countersignConfirmationOpen, setCountersignConfirmationOpen] = useState(false);
  const [sendingConfirmationEmail, setSendingConfirmationEmail] = useState(false);
  const [confirmationEmailSentAt, setConfirmationEmailSentAt] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<AdminReviewStep>("customer");

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

  useBookingRealtime({ bookingId, onChange: loadDetails });

  // A pending booking that reached the requirements step with no documents
  // submitted is rejected immediately. The server re-checks eligibility, and
  // each booking is only attempted once per page visit.
  const autoRejectAttemptedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!state) return;
    const { booking: loadedBooking } = state.details;
    const shouldReject = shouldAutoRejectForMissingRequirements({
      status: loadedBooking.status,
      requirementsStatus: loadedBooking.requirementsStatus,
      paymentProofSubmitted: state.payments.some((payment) =>
        (PAYMENT_PROOF_SUBMITTED_STATUSES as readonly string[]).includes(payment.status),
      ),
    });
    if (!shouldReject || autoRejectAttemptedFor.current === loadedBooking.id) return;
    autoRejectAttemptedFor.current = loadedBooking.id;

    void (async () => {
      try {
        if (await autoRejectBookingForMissingRequirements(loadedBooking.id)) {
          await loadDetails();
          showToast(AUTO_REJECT_DECLINE_DETAILS, "info");
        }
      } catch {
        showToast("This booking could not be rejected automatically. Please refresh and try again.", "error");
      }
    })();
  }, [state, loadDetails, showToast]);

  const actions = useMemo(
    () => (state ? ADMIN_BOOKING_ACTIONS[state.details.booking.status] : []),
    [state],
  );

  const selectedAction = actions.find((action) => action.status === selectedStatus);
  const isDeclineAction = selectedAction?.status === "rejected";
  const declineIncomplete = isDeclineAction && (!declineReason || note.trim().length < 5);

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

  function requestStatusAction() {
    if (!state || !selectedStatus || !selectedAction) return;
    if (isDeclineAction) {
      if (!declineReason) {
        showToast("Select a decline reason before continuing.", "warning");
        return;
      }
      if (note.trim().length < 5) {
        showToast("Add a short explanation of what was found before continuing.", "warning");
        return;
      }
    } else if (selectedAction.requiresNote && !note.trim()) {
      showToast("Please add administrator notes for this action.", "warning");
      return;
    }
    void confirmStatusAction();
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
          "warning",
        );
        await loadDetails();
        setSelectedStatus("");
        setNote("");
        setDeclineReason("");
        return;
      }

      const noteToSend = isDeclineAction ? formatDeclineNote(declineReason, note) : note;
      const updateResult = await updateAdminBookingStatus(bookingId, selectedStatus, noteToSend);
      await loadDetails();
      setSelectedStatus("");
      setNote("");
      setDeclineReason("");
      if (updateResult.emailRequired && !updateResult.emailSent) {
        showToast(
          updateResult.emailReason === "not_configured"
            ? `Booking updated: ${selectedAction.label}. The customer wasn't emailed because booking emails aren't set up yet, so please contact the customer directly.`
            : `Booking updated: ${selectedAction.label}. We couldn't email the customer, so please contact them directly.`,
          "warning",
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

  async function handleSendBookingConfirmationEmail() {
    setSendingConfirmationEmail(true);
    try {
      const result = await sendAdminBookingConfirmationEmail(bookingId);
      setConfirmationEmailSentAt(new Date().toISOString());
      showToast(`Booking confirmation sent to ${result.emailedTo}.`, "success");
    } catch (sendError) {
      showToast(
        sendError instanceof Error
          ? sendError.message
          : "The booking confirmation email could not be sent.",
        "error",
      );
    } finally {
      setSendingConfirmationEmail(false);
    }
  }

  function requestCancellationDecision(decision: "approved" | "rejected") {
    const request = state?.details.booking.cancellationRequest;
    if (!request || request.status !== "pending") return;
    setCancellationDecision(decision);
  }

  async function confirmCancellationDecision() {
    const request = state?.details.booking.cancellationRequest;
    const decision = cancellationDecision;
    if (!request || request.status !== "pending" || !decision) return;
    if (decision === "rejected" && cancellationNote.trim().length < 5) {
      showToast("Add a short explanation when rejecting a cancellation request.", "warning");
      return;
    }

    setReviewingCancellation(true);
    try {
      await reviewAdminCancellationRequest(
        bookingId,
        request.id,
        decision,
        cancellationNote.trim(),
      );
      await loadDetails();
      setCancellationNote("");
      setCancellationDecision("");
      showToast(
        decision === "approved"
          ? "Cancellation approved. The booking was cancelled and its reserved dates were released."
          : "Cancellation request rejected. The booking remains active.",
        "success",
      );
    } catch (reviewError) {
      showToast(
        reviewError instanceof Error ? reviewError.message : "The cancellation request could not be reviewed.",
        "error",
      );
    } finally {
      setReviewingCancellation(false);
      setCancellationDecision("");
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
      showToast("Enter the authorized business signer's complete name.", "warning");
      return;
    }
    if (!countersignAcknowledged) {
      showToast("Confirm that you are authorized to countersign for the business.", "warning");
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
  const cancellationRequest = booking.cancellationRequest;
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
  const remainingBalance = Math.max(0, booking.totalAmount - amountPaid);
  const currentPayment = payments.find((payment) => payment.status !== "rejected") ?? payments[0];
  const paymentTypeLabel = currentPayment
    ? currentPayment.stage === "down_payment" ? "Down Payment" : "Full Payment"
    : amountPaid >= booking.totalAmount - 0.01
      ? "Full Payment"
      : "Not Started";
  const accountTypeLabel = booking.isGuestCheckout ? "Guest checkout" : "Registered account";
  const fulfillmentLabel = formatStatus(booking.fulfillmentMethod);
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
  const isClosedRecord = booking.status === "returned" || booking.status === "cancelled" || booking.status === "rejected";
  const itemsSummary = bookingItemsSummaryData(booking, agreement);
  const requirementsAttention = booking.requirementsStatus === "rejected" || documents.some((document) => document.reviewStatus === "rejected");
  const paymentAttention = payments.some((payment) => payment.status === "rejected") && amountPaid < booking.totalAmount - 0.01;
  const agreementAttention = booking.agreementStatus === "rejected";
  const autoRejectedForRequirements =
    booking.status === "rejected" && Boolean(getRejectionReason(statusHistory)?.includes(AUTO_REJECT_DECLINE_DETAILS));
  const requirementsEmptyMessage = autoRejectedForRequirements
    ? AUTO_REJECT_DECLINE_DETAILS
    : "No required documents have been submitted for this booking.";
  const reviewChecks = [
    {
      label: "Payment",
      value: paymentStatusLabel,
      detail: paymentAttention
        ? "A payment proof was rejected and needs attention"
        : amountPaid > 0
        ? `PHP ${amountPaid.toLocaleString("en-PH")} verified`
        : payments.length ? "Payment submitted for review" : "No payment submitted",
      ready: amountPaid > 0 && !paymentAttention,
      state: paymentAttention ? "attention" : amountPaid > 0 ? "complete" : "pending",
    },
    {
      label: "Verification",
      value: REQUIREMENTS_STATUS_LABELS[booking.requirementsStatus] ?? formatStatus(booking.requirementsStatus),
      detail: requirementsAttention
        ? "One or more files need correction"
        : documents.length ? `${documents.length} submitted file${documents.length === 1 ? "" : "s"}` : "No files submitted",
      ready: booking.requirementsStatus === "approved" && !requirementsAttention,
      state: requirementsAttention ? "attention" : booking.requirementsStatus === "approved" ? "complete" : "pending",
    },
    {
      label: "Agreement",
      value: AGREEMENT_STATUS_LABELS[booking.agreementStatus] ?? formatStatus(booking.agreementStatus),
      detail: businessSignature
        ? `Countersigned by ${businessSignature.signerName}`
        : customerSignature
          ? "Customer signed; business countersignature required"
          : agreementAttention ? "Agreement needs attention" : agreement ? "Customer signature pending" : "Agreement not started",
      ready: booking.agreementStatus === "completed" && !agreementAttention,
      state: agreementAttention ? "attention" : booking.agreementStatus === "completed" ? "complete" : "pending",
    },
    {
      label: "Inventory",
      value: inventoryReady ? "Reserved" : "Needs Assignment",
      detail: `${totalAssignedUnits}/${totalUnits} unit(s) reserved`,
      ready: inventoryReady,
      state: inventoryReady ? "complete" : "pending",
    },
  ];
  const remainingChecks = reviewChecks.filter((check) => !check.ready).length;
  const primaryAction = actions.find((action) => action.tone !== "danger") ?? null;
  const bookingApproved = ["approved", "confirmed", "ready_for_release", "released"].includes(booking.status);
  const finalDecisionLabel = booking.status === "pending"
    ? remainingChecks === 0 ? "Ready for Approval" : "Pending"
    : booking.status === "returned"
      ? "Returned / Completed"
      : booking.status === "cancelled"
        ? "Cancelled"
        : booking.status === "rejected"
          ? "Rejected"
          : bookingApproved
            ? "Approved"
            : "Pending";
  const finalDecisionTone = booking.status === "cancelled" || booking.status === "rejected"
    ? "attention"
    : booking.status === "pending" && remainingChecks > 0
      ? "pending"
      : "complete";
  const finalActionTitle = primaryAction?.status === "approved" || primaryAction?.status === "confirmed"
    ? "Approve / Confirm Booking"
    : primaryAction?.label ?? "Booking decision recorded";

  const stepState: Record<AdminReviewStep, ReviewState> = {
    customer: email !== "-" && phone !== "-" ? "complete" : "not-started",
    rental: booking.items.length > 0 ? "complete" : "not-started",
    requirements: requirementsAttention ? "attention" : booking.requirementsStatus === "approved" ? "complete" : documents.length ? "pending" : "not-started",
    payment: paymentAttention ? "attention" : amountPaid > 0 ? "complete" : payments.length ? "pending" : "not-started",
    agreement: agreementAttention ? "attention" : booking.agreementStatus === "completed" ? "complete" : agreement ? "pending" : "not-started",
    final: isClosedRecord || FINAL_REVIEW_STATUSES.includes(booking.status) ? "complete" : remainingChecks === 0 ? "pending" : "not-started",
    history: statusHistory.length > 0 ? "complete" : "not-started",
  };

  function jumpToNextStep() {
    setActiveStep("final");
    if (primaryAction) {
      setSelectedStatus(primaryAction.status);
      setNote("");
    }
    window.setTimeout(() => {
      document.getElementById("admin-workspace-nav")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function renderActionChoice(action: (typeof actions)[number]) {
    const selected = action.status === selectedStatus;
    const blockedByBalance = action.status === "released" && !handoverPaymentReady;
    return (
      <Button variant="none"
        key={action.status}
        type="button"
        className={`${styles.actionChoice} ${action.tone === "danger" ? styles.dangerChoice : ""} ${selected ? styles.actionChoiceSelected : ""}`}
        onClick={() => { setSelectedStatus(action.status); setNote(""); setDeclineReason(""); }}
        aria-pressed={selected}
        disabled={updating || blockedByBalance}
      >
        <span className={styles.actionChoiceIcon} aria-hidden="true">{action.tone === "danger" ? "!" : "✓"}</span>
        <span className={styles.actionChoiceCopy}>
          <small>{action.tone === "danger" ? "Close booking" : action.status === primaryAction?.status ? "Recommended next step" : "Alternative action"}</small>
          <strong>{action.label}</strong>
          <span>{blockedByBalance ? "Record the remaining balance or approve a pay-later exception in Requirements first." : action.description}</span>
        </span>
        <span className={styles.actionChoiceState}>{selected ? "Selected" : "Select"}</span>
      </Button>
    );
  }

  return (
    <div className={styles.page}>
      <Link href="/admin/bookings" className={styles.backLink}>Back to Bookings</Link>

      <header className={styles.header}>
        <div className={styles.headerIdentity}>
          <p className={styles.eyebrow}>BOOKING REVIEW</p>
          <h1>{booking.bookingRef}</h1>
          <p className={styles.headerContext}>
            <strong>{fullName}</strong>
            {booking.isGuestCheckout ? <GuestBadge /> : null}
            <span aria-hidden="true">·</span>
            <span>{bookingHeadline(booking.items)}</span>
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.headerStatus}>
            <small>Current status</small>
            <StatusBadge status={booking.status} />
          </div>
          <Button variant="none"
            type="button"
            className={styles.exportButton}
            onClick={handlePdfExport}
            disabled={exporting}
          >
            {exporting ? "Preparing PDF..." : "Export to PDF"}
          </Button>
        </div>
      </header>

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
          <details className={styles.collapsibleBlock}>
            <summary className={styles.expandLabel}>View full booking details</summary>
            <dl className={styles.snapshotFacts}>
              <div>
                <dt>Customer</dt>
                <dd className={styles.customerNameRow}>{fullName}</dd>
              </div>
              <div><dt>Contact</dt><dd>{phone}<small>{email}</small></dd></div>
              <div><dt>Account type</dt><dd>{accountTypeLabel}</dd></div>
              <div><dt>Rental item</dt><dd>{bookingHeadline(booking.items)}</dd></div>
              <div><dt>Rental dates</dt><dd>{formatDate(booking.startDate)} — {formatDate(booking.endDate)}</dd></div>
              <div><dt>Duration</dt><dd>{booking.dayCount} day{booking.dayCount === 1 ? "" : "s"}</dd></div>
              <div><dt>Quantity / units</dt><dd>{totalUnits} unit{totalUnits === 1 ? "" : "s"}</dd></div>
              <div><dt>Fulfillment</dt><dd>{fulfillmentLabel}<small>{booking.location || "Location not provided"}</small></dd></div>
              <div><dt>Payment status</dt><dd>{paymentStatusLabel}<small>{amountPaid > 0 ? `PHP ${amountPaid.toLocaleString("en-PH")} verified` : "No verified payment"}</small></dd></div>
              <div><dt>Payment type</dt><dd>{paymentTypeLabel}<small>{remainingBalance > 0.01 ? `PHP ${remainingBalance.toLocaleString("en-PH")} remaining` : "Fully paid"}</small></dd></div>
              <div><dt>Total</dt><dd>{totalAmount}</dd></div>
              {remainingBalance > 0.01 ? <div><dt>Remaining balance</dt><dd>PHP {remainingBalance.toLocaleString("en-PH")}</dd></div> : null}
              <div><dt>Current status</dt><dd>{formatStatus(booking.status)}<small>{getFulfillmentProgressLabel(booking.status, booking.fulfillmentMethod)}</small></dd></div>
              <div><dt>Created</dt><dd>{formatDate(booking.createdAt, true)}</dd></div>
            </dl>
          </details>
          <div className={styles.summaryChecklist}>
            <div className={styles.summaryChecklistHead}>
              <span>Review checklist</span>
              <span className={remainingChecks === 0 ? styles.readyPill : styles.pendingPill}>
                {isClosedRecord ? "Closed record" : remainingChecks === 0 ? "Ready for the next action" : `${remainingChecks} check${remainingChecks === 1 ? "" : "s"} remaining`}
              </span>
            </div>
            <div className={styles.checklistChips}>
              {reviewChecks.map((check) => (
                <div
                  key={check.label}
                  className={styles[check.state === "complete" ? "checkChipReady" : check.state === "attention" ? "checkChipAttention" : check.state === "not-started" ? "checkChipNotStarted" : "checkChipPending"]}
                  title={check.detail}
                >
                  <span aria-hidden="true">{check.state === "complete" ? "✓" : check.state === "attention" ? "!" : check.state === "not-started" ? "—" : "•"}</span>
                  <div><small>{check.label}</small><strong>{check.value}</strong></div>
                </div>
              ))}
            </div>
          </div>
          {primaryAction ? (
            <Button variant="none" type="button" className={styles.statusHeroButton} onClick={jumpToNextStep}>
              Go to Final Review — {primaryAction.label}
            </Button>
          ) : null}
          <div className={styles.snapshotFooter}>
            <span>Created {formatDate(booking.createdAt, true)}</span>
            <Link href={`/admin/users/${booking.customerId}`}>View customer account</Link>
          </div>
        </article>
      </section>

      {cancellationRequest ? (
        <section className={styles.cancellationRequestPanel} aria-labelledby="cancellation-request-heading">
          <div className={styles.cancellationRequestHeader}>
            <div>
              <span className={styles.cancellationRequestEyebrow}>CUSTOMER CANCELLATION</span>
              <h2 id="cancellation-request-heading">
                {cancellationRequest.status === "pending" ? "Cancellation request needs a decision" : "Latest cancellation request"}
              </h2>
              <p>Requested {formatDate(cancellationRequest.requestedAt, true)} while the booking was <strong>{formatStatus(cancellationRequest.requestedStatus)}</strong>.</p>
            </div>
            <span className={`${styles.cancellationRequestStatus} ${styles[`cancellationRequestStatus${cancellationRequest.status[0].toUpperCase()}${cancellationRequest.status.slice(1)}`]}`}>
              {formatStatus(cancellationRequest.status)}
            </span>
          </div>
          <div className={styles.cancellationReason}>
            <span>Customer reason</span>
            <p>{cancellationRequest.reason}</p>
            {cancellationRequest.additionalDetails ? (
              <>
                <span>Additional details</span>
                <p>{cancellationRequest.additionalDetails}</p>
              </>
            ) : null}
          </div>
          {cancellationRequest.status === "pending" ? (
            <div className={styles.cancellationDecisionControls}>
              <div className={styles.cancellationDecisionButtons}>
                <Button variant="none"
                  type="button"
                  className={styles.cancellationRejectButton}
                  onClick={() => requestCancellationDecision("rejected")}
                  disabled={reviewingCancellation}
                >
                  Reject request
                </Button>
                <Button variant="none"
                  type="button"
                  className={styles.cancellationApproveButton}
                  onClick={() => requestCancellationDecision("approved")}
                  disabled={reviewingCancellation}
                >
                  Approve cancellation
                </Button>
              </div>
            </div>
          ) : (
            <p className={styles.cancellationDecisionNote}>
              {cancellationRequest.decisionNote || "No administrator response was recorded."}
            </p>
          )}
        </section>
      ) : null}

      {cancellationRequest && cancellationRequest.status === "pending" && cancellationDecision ? (
        <ConfirmModal
          title={cancellationDecision === "approved" ? "Approve Cancellation Request" : "Reject Cancellation Request"}
          description={`Are you sure you want to ${cancellationDecision === "approved" ? "approve" : "reject"} this cancellation request?`}
          confirmLabel={cancellationDecision === "approved" ? "Yes, Approve Cancellation" : "Yes, Reject Request"}
          busyLabel={cancellationDecision === "approved" ? "Approving..." : "Rejecting..."}
          tone="danger"
          onCancel={() => { setCancellationDecision(""); setCancellationNote(""); }}
          onConfirm={() => void confirmCancellationDecision()}
          confirmDisabled={cancellationDecision === "rejected" && cancellationNote.trim().length < 5}
          busy={reviewingCancellation}
        >
          <label className={styles.noteField}>
            <span>Response to customer{cancellationDecision === "rejected" ? " (required for rejection)" : " (optional)"}</span>
            <textarea
              value={cancellationNote}
              onChange={(event) => setCancellationNote(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Explain the decision or any next steps"
              disabled={reviewingCancellation}
            />
          </label>
        </ConfirmModal>
      ) : null}

      <nav id="admin-workspace-nav" className={styles.stepNav} aria-label="Booking review steps" role="tablist">
        {REVIEW_STEPS.map((step, index) => {
          const status = stepState[step.id];
          const done = status === "complete";
          const current = activeStep === step.id;
          const stateClass = current
            ? styles.stepCurrent
            : done
              ? styles.stepDone
              : status === "attention"
                ? styles.stepAttention
                : status === "not-started"
                  ? styles.stepNotStarted
                  : styles.stepUpcoming;
          return (
            <Button variant="none"
              key={step.id}
              type="button"
              role="tab"
              id={`booking-tab-${step.id}`}
              aria-selected={current}
              aria-controls={`booking-step-${step.id}`}
              tabIndex={0}
              aria-current={current ? "step" : undefined}
              aria-label={`${step.label}: ${status === "complete" ? "Completed" : status === "attention" ? "Needs attention" : status === "not-started" ? "Not started" : "Pending"}`}
              className={`${styles.step} ${stateClass}`}
              onClick={() => setActiveStep(step.id)}
              onKeyDown={(event) => {
                const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                const nextIndex = event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? REVIEW_STEPS.length - 1
                    : (index + direction + REVIEW_STEPS.length) % REVIEW_STEPS.length;
                if (direction === 0 && event.key !== "Home" && event.key !== "End") return;
                event.preventDefault();
                const nextStep = REVIEW_STEPS[nextIndex];
                setActiveStep(nextStep.id);
                window.setTimeout(() => document.getElementById(`booking-tab-${nextStep.id}`)?.focus(), 0);
              }}
            >
              <span className={styles.stepMarker} aria-hidden="true">
                {done && !current ? "✓" : index + 1}
              </span>
              <span className={styles.stepLabel}>{step.label}</span>
            </Button>
          );
        })}
      </nav>

      <div className={styles.detailSections}>
        <section id="booking-step-customer" className={styles.detailSection} role="tabpanel" aria-labelledby="booking-tab-customer" hidden={activeStep !== "customer"}>
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
              <div><dt>Full Name</dt><dd>{fullName}</dd></div>
              <div><dt>Email Address</dt><dd>{email}</dd></div>
              <div><dt>Phone Number</dt><dd>{phone}</dd></div>
              <div className={styles.fullDetail}><dt>Complete Address</dt><dd>{address}</dd></div>
              <div className={styles.socialRow}>
                <div><dt>Facebook</dt><dd>{facebook ? <a href={facebook} target="_blank" rel="noopener noreferrer">Open Profile</a> : "-"}</dd></div>
                <div><dt>Instagram</dt><dd>{instagram ? <a href={instagram} target="_blank" rel="noopener noreferrer">Open Profile</a> : "-"}</dd></div>
              </div>
            </dl>
          </div>
        </section>

        <section id="booking-step-rental" className={styles.detailSection} role="tabpanel" aria-labelledby="booking-tab-rental" hidden={activeStep !== "rental"}>
          <div className={styles.detailSectionHeader}>
            <span className={styles.sectionNumber}>02</span>
            <div><strong>Rental Details</strong><small>Dates, handover, items and pricing</small></div>
            <span className={styles.sectionHeaderStatus}>{totalUnits} unit{totalUnits === 1 ? "" : "s"}</span>
          </div>
          <div className={styles.detailBody}>
            <dl className={`${styles.detailGrid} ${styles.rentalFacts}`}>
              <div><dt>Rental Period</dt><dd>{formatDate(booking.startDate)} — {formatDate(booking.endDate)}</dd></div>
              <div><dt>Duration</dt><dd>{booking.dayCount} day{booking.dayCount === 1 ? "" : "s"}</dd></div>
              <div><dt>Handover Method</dt><dd>{formatStatus(booking.fulfillmentMethod)}</dd></div>
              <div><dt>Pickup/Delivery Location</dt><dd>{booking.location || "Not provided"}</dd></div>
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

        <section id="booking-step-requirements" className={styles.detailSection} role="tabpanel" aria-labelledby="booking-tab-requirements" hidden={activeStep !== "requirements"}>
          <div className={styles.detailSectionHeader}>
            <span className={styles.sectionNumber}>03</span>
            <div><strong>Requirements</strong><small>{REQUIREMENTS_STATUS_LABELS[booking.requirementsStatus] ?? formatStatus(booking.requirementsStatus)} · {documents.length} file{documents.length === 1 ? "" : "s"}</small></div>
            <span className={`${styles.sectionHeaderStatus} ${requirementsAttention ? styles.sectionHeaderAttention : booking.requirementsStatus === "approved" ? styles.sectionHeaderReady : booking.requirementsStatus === "pending_review" ? styles.sectionHeaderPending : ""}`}>{REQUIREMENTS_STATUS_LABELS[booking.requirementsStatus] ?? formatStatus(booking.requirementsStatus)}</span>
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
            </> : <p className={autoRejectedForRequirements ? styles.emptyRejected : styles.empty} role={autoRejectedForRequirements ? "status" : undefined}>{requirementsEmptyMessage}</p>}
          </div>
        </section>

        <section id="booking-step-payment" className={styles.detailSection} role="tabpanel" aria-labelledby="booking-tab-payment" hidden={activeStep !== "payment"}>
          <div className={styles.detailSectionHeader}>
            <span className={styles.sectionNumber}>04</span>
            <div><strong>Payment &amp; Documents</strong><small>{paymentStatusLabel} · {payments.length} attempt{payments.length === 1 ? "" : "s"}</small></div>
            <span className={`${styles.sectionHeaderStatus} ${paymentAttention ? styles.sectionHeaderAttention : amountPaid >= booking.totalAmount - 0.01 ? styles.sectionHeaderReady : amountPaid > 0 ? styles.sectionHeaderPending : ""}`}>{paymentStatusLabel}</span>
          </div>
          <div className={styles.detailBody}>
            <article className={styles.recordCard}>
              <dl className={styles.paymentFacts}>
                <div><dt>Payment Type</dt><dd>{paymentTypeLabel}</dd></div>
                <div><dt>Verified Amount</dt><dd>PHP {amountPaid.toLocaleString("en-PH")}</dd></div>
                <div><dt>Booking Total</dt><dd>PHP {booking.totalAmount.toLocaleString("en-PH")}</dd></div>
                <div><dt>Balance</dt><dd>PHP {remainingBalance.toLocaleString("en-PH")}</dd></div>
                <div><dt>Payment Attempts</dt><dd>{payments.length}</dd></div>
                <div><dt>Receipts</dt><dd>{receipts.length}</dd></div>
              </dl>
              <div className={styles.proofsReceiptsHeader}><span>Proofs / Receipts</span></div>
              {payments.some((payment) => payment.proofStorageBucket && payment.proofStoragePath) || receipts.some((receipt) => receipt.documentPath) ? (
                <div className={styles.proofsReceiptsGrid}>
                  {payments.filter((payment) => payment.proofStorageBucket && payment.proofStoragePath).map((payment) => (
                    <Button
                      key={`proof-${payment.id}`}
                      variant="none"
                      type="button"
                      className={styles.proofCard}
                      onClick={() => openPrivateFile(
                        payment.proofStorageBucket as Parameters<typeof getBookingFileUrl>[1],
                        payment.proofStoragePath!,
                      )}
                    >
                      <span className={styles.receiptIcon}>PROOF</span>
                      <span><strong>{formatStatus(payment.stage)}</strong><small>Open Proof</small></span>
                    </Button>
                  ))}
                  {receipts.filter((receipt) => receipt.documentPath).map((receipt) => (
                    <Button
                      key={`receipt-${receipt.id}`}
                      variant="none"
                      type="button"
                      className={styles.proofCard}
                      onClick={() => openPrivateFile("receipts", receipt.documentPath!)}
                    >
                      <span className={styles.receiptIcon}>PDF</span>
                      <span><strong>{receipt.receiptNumber ?? receipt.id.slice(0, 8)}</strong><small>Open Receipt</small></span>
                    </Button>
                  ))}
                </div>
              ) : <p className={styles.emptyRecord}>No payment proofs or receipts are available yet.</p>}
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

        <section id="booking-step-agreement" className={styles.detailSection} role="tabpanel" aria-labelledby="booking-tab-agreement" hidden={activeStep !== "agreement"}>
          <div className={styles.detailSectionHeader}>
            <span className={styles.sectionNumber}>05</span>
            <div><strong>Rental Agreement</strong><small>{AGREEMENT_STATUS_LABELS[booking.agreementStatus] ?? formatStatus(booking.agreementStatus)}</small></div>
            <span className={`${styles.sectionHeaderStatus} ${agreementAttention ? styles.sectionHeaderAttention : agreement?.status === "completed" ? styles.sectionHeaderReady : agreement ? styles.sectionHeaderPending : ""}`}>{agreement?.status === "awaiting_business_signature" ? "Action required" : AGREEMENT_STATUS_LABELS[booking.agreementStatus] ?? formatStatus(booking.agreementStatus)}</span>
          </div>
          <div className={styles.detailBody}>
              <article className={`${styles.recordCard} ${styles.agreementCard}`}>
                <div className={styles.recordHeader}>
                  <div><span>RENTAL AGREEMENT</span><h3>Signature Workflow</h3></div>
                  <span className={`${styles.recordStatus} ${agreement?.status === "completed" ? styles.recordComplete : styles.recordPending}`}>
                    {AGREEMENT_STATUS_LABELS[booking.agreementStatus] ?? formatStatus(booking.agreementStatus)}
                  </span>
                </div>

                {agreement ? <>
                  <div className={styles.signatureStatusRow}>
                    <div className={`${styles.signatureStatusCard} ${customerSignature ? styles.signatureStatusComplete : styles.signatureStatusCurrent}`}>
                      <span className={styles.signatureStatusBadge}>{customerSignature ? "Complete" : "In progress"}</span>
                      <strong>Customer Signature</strong>
                      <small>{customerSignature ? `${customerSignature.signerName} · ${formatDate(customerSignature.signedAt, true)}` : "Waiting for customer"}</small>
                    </div>
                    <div className={`${styles.signatureStatusCard} ${businessSignature ? styles.signatureStatusComplete : customerSignature ? styles.signatureStatusCurrent : styles.signatureStatusPending}`}>
                      <span className={styles.signatureStatusBadge}>{businessSignature ? "Complete" : customerSignature ? "In progress" : "Pending"}</span>
                      <strong>Business Countersignature</strong>
                      <small>{businessSignature ? `${businessSignature.signerName} · ${formatDate(businessSignature.signedAt, true)}` : customerSignature ? "Admin reviews and countersigns" : "Available after customer signs"}</small>
                    </div>
                    <div className={`${styles.signatureStatusCard} ${agreement.finalDocumentPath ? styles.signatureStatusComplete : styles.signatureStatusPending}`}>
                      <span className={styles.signatureStatusBadge}>{agreement.finalDocumentPath ? "Complete" : "Pending"}</span>
                      <strong>Final Agreement PDF</strong>
                      <small>{agreement.finalDocumentPath ? "Ready for admin and customer" : "Created after both signatures"}</small>
                    </div>
                  </div>

                  {agreement.status === "awaiting_business_signature" ? (
                    <div className={styles.countersignPanel}>
                      <div className={styles.countersignIntro}>
                        <span>ADMIN ACTION REQUIRED</span>
                        <h4>Review, countersign, and finalize</h4>
                        <p>The customer has completed their part. Verify the payment and all required documents, then enter the authorized business signer&apos;s name.</p>
                      </div>
                      <div className={styles.countersignGroup}>
                        <span>1 · Review requirements</span>
                        <div className={styles.readinessChecks}>
                          <span className={amountPaid > 0 ? styles.ready : styles.notReady}>{amountPaid > 0 ? "✓" : "!"} Payment Verified</span>
                          <span className={booking.requirementsStatus === "approved" ? styles.ready : styles.notReady}>{booking.requirementsStatus === "approved" ? "✓" : "!"} Documents Approved</span>
                          <span className={customerSignature ? styles.ready : styles.notReady}>{customerSignature ? "✓" : "!"} Customer Signed</span>
                        </div>
                        {!canCountersignAgreement ? (
                          <p className={styles.blockedMessage}>Complete every check above before the business countersignature becomes available.</p>
                        ) : null}
                      </div>

                      <div className={styles.signerAndAuthGroup}>
                        <div className={styles.countersignGroup}>
                          <span>2 · Authorized Business Signer</span>
                          <label className={styles.signerField}>
                            <input
                              value={businessSignerName}
                              onChange={(event) => setBusinessSignerName(event.target.value)}
                              maxLength={120}
                              placeholder="Enter the person signing for Maddy & Cassy"
                              disabled={!canCountersignAgreement || countersigning}
                            />
                          </label>
                        </div>

                        <div className={styles.countersignGroup}>
                          <span>3 · Authorization Confirmation</span>
                          <label className={styles.authorizationCheck}>
                            <input
                              type="checkbox"
                              checked={countersignAcknowledged}
                              onChange={(event) => setCountersignAcknowledged(event.target.checked)}
                              disabled={!canCountersignAgreement || countersigning}
                            />
                            <span>I confirm that I am authorized to countersign this rental agreement for Rental by Maddy &amp; Cassy.</span>
                          </label>
                        </div>
                      </div>

                      <div className={styles.countersignGroup}>
                        <span>4 · Finalize Agreement</span>
                        <Button variant="none"
                          type="button"
                          className={styles.countersignButton}
                          onClick={requestCountersignAgreement}
                          disabled={!canCountersignAgreement || !businessSignerName.trim() || !countersignAcknowledged || countersigning}
                        >
                          {countersigning ? "Finalizing agreement..." : "Countersign & Finalize Agreement"}
                        </Button>
                        <small className={styles.legalNote}>This records the administrator, signer name, timestamp, IP address, and finalized PDF in the audit trail.</small>
                      </div>
                    </div>
                  ) : null}

                  {agreement.status === "completed" ? (
                    <div className={styles.completedAgreement}>
                      <div><span aria-hidden="true">✓</span><div><strong>Agreement fully signed</strong><p>No further signature action is needed. The customer can access the final PDF from My Bookings.</p></div></div>
                      {booking.status === "approved" ? <p className={styles.nextAdminStep}><strong>Next admin step:</strong> Use “Update this booking” above and choose “Confirm Booking.” The customer will then receive the final booking confirmation.</p> : null}
                      {booking.status === "pending" ? <p className={styles.nextAdminStep}><strong>Next admin step:</strong> Approve the booking first, then confirm it after every checklist item is complete.</p> : null}
                      <div className={styles.agreementButtons}>
                        {agreement.finalDocumentPath ? <Button variant="none" type="button" onClick={() => openPrivateFile("agreements", agreement.finalDocumentPath!)}>Open final agreement</Button> : null}
                        {customerSignature?.signaturePath ? <Button variant="none" type="button" className={styles.secondaryRecordButton} onClick={() => openPrivateFile("customer-documents", customerSignature.signaturePath!)}>View customer signature</Button> : null}
                      </div>
                    </div>
                  ) : null}
                </> : <p className={styles.emptyRecord}>The customer has not submitted a rental agreement yet.</p>}
              </article>
          </div>
        </section>

        <section id="booking-step-final" className={styles.detailSection} role="tabpanel" aria-labelledby="booking-tab-final" hidden={activeStep !== "final"}>
          <div className={styles.detailSectionHeader}>
            <span className={styles.sectionNumber}>06</span>
            <div><strong>Final Review</strong><small>Decision summary and booking actions</small></div>
            <span className={`${styles.sectionHeaderStatus} ${finalDecisionTone === "complete" ? styles.sectionHeaderReady : finalDecisionTone === "attention" ? styles.sectionHeaderAttention : styles.sectionHeaderPending}`}>
              {finalDecisionLabel}
            </span>
          </div>
          <div className={styles.detailBody}>
            <div className={styles.finalReviewBlockHeading}>
              <span>Booking Summary</span>
              <p>All important booking, customer, payment, fulfillment, and status details in one place.</p>
            </div>
            <details className={styles.collapsibleBlock}>
              <summary className={styles.expandLabel}>View full booking record</summary>
              <div className={styles.finalReviewSummary} aria-label="Final review booking summary">
                <div><span>Booking Number</span><strong>{booking.bookingRef}</strong></div>
                <div><span>Customer</span><strong>{fullName}</strong></div>
                <div><span>Account Type</span><strong>{accountTypeLabel}</strong></div>
                <div><span>Contact</span><strong>{phone}<small>{email}</small></strong></div>
                <div><span>Rental Item</span><strong>{bookingHeadline(booking.items)}<small>{totalUnits} unit{totalUnits === 1 ? "" : "s"}</small></strong></div>
                <div><span>Rental Dates</span><strong>{formatDate(booking.startDate)} - {formatDate(booking.endDate)}</strong></div>
                <div><span>Duration</span><strong>{booking.dayCount} day{booking.dayCount === 1 ? "" : "s"}</strong></div>
                <div><span>Verification Status</span><strong>{REQUIREMENTS_STATUS_LABELS[booking.requirementsStatus] ?? formatStatus(booking.requirementsStatus)}</strong></div>
                <div><span>Payment Status</span><strong>{paymentStatusLabel}</strong></div>
                <div><span>Fulfillment</span><strong>{fulfillmentLabel}<small>{booking.location || "Location not provided"}</small></strong></div>
                <div><span>Payment Type</span><strong>{paymentTypeLabel}</strong></div>
                <div><span>Amount Paid</span><strong>PHP {amountPaid.toLocaleString("en-PH")}</strong></div>
                <div><span>Remaining Balance</span><strong>PHP {remainingBalance.toLocaleString("en-PH")}</strong></div>
                <div><span>Agreement Status</span><strong>{AGREEMENT_STATUS_LABELS[booking.agreementStatus] ?? formatStatus(booking.agreementStatus)}</strong></div>
                <div><span>Inventory Status</span><strong>{inventoryReady ? "Reserved" : `${totalAssignedUnits}/${totalUnits} reserved`}</strong></div>
                <div><span>Current Booking Status</span><strong>{formatStatus(booking.status)}</strong></div>
              </div>
            </details>
            <section className={`${styles.completionStatus} ${styles[`completionStatus${finalDecisionTone[0].toUpperCase()}${finalDecisionTone.slice(1)}`]}`} aria-labelledby="completion-status-heading">
              <div className={styles.completionStatusHeading}>
                <div>
                  <span>Booking Readiness Summary</span>
                  <h2 id="completion-status-heading">{finalDecisionLabel}</h2>
                  <p>{isClosedRecord ? "This decision is recorded. The booking history remains available below." : remainingChecks > 0 ? "The items below still need attention before the booking can move forward." : "All four review areas are complete for the next booking decision."}</p>
                </div>
                <strong>{remainingChecks === 0 ? "4 / 4 complete" : `${4 - remainingChecks} / 4 complete`}</strong>
              </div>
            </section>
            <section className={styles.pendingRequirements} aria-labelledby="pending-requirements-heading">
              <div className={styles.pendingRequirementsHeading}>
                <span>Pending Requirements</span>
                <h2 id="pending-requirements-heading">Review status by area</h2>
                <p>Each area must be ready before the booking can move to its next decision.</p>
              </div>
              <div className={styles.finalChecklist} aria-label="Final completion checklist">
                {reviewChecks.map((check) => (
                  <div key={check.label} className={styles[`finalCheck${check.state[0].toUpperCase()}${check.state.slice(1)}`]}>
                    <span aria-hidden="true">{check.state === "complete" ? "✓" : check.state === "attention" ? "!" : "•"}</span>
                    <div><strong>{check.label}</strong><b>{check.value}</b><small>{check.detail}</small></div>
                  </div>
                ))}
              </div>
            </section>
            {isClosedRecord ? (
              <p className={styles.finalRecordNote}>
                This is a closed booking record. Historical steps and actions remain available for reference; no further booking action is available.
              </p>
            ) : null}
            <div className={styles.actionPanel} aria-labelledby="booking-action-heading">
              <div className={styles.actionIntro}>
                <span>Final Decision</span>
                <h2 id="booking-action-heading">{isClosedRecord ? "No further action needed" : finalActionTitle}</h2>
                <p>{isClosedRecord ? "This booking is complete or closed. Historical details remain available for reference." : "Choose the final booking decision below. A confirmation popup will appear before anything is applied."}</p>
              </div>
              {actions.length ? (
                <div className={styles.actionControls}>
                  <div className={`${styles.actionChoiceGrid} ${actions.length === 1 ? styles.actionChoiceGridSingle : ""}`} aria-label="Available booking actions">
                    {actions.map(renderActionChoice)}
                  </div>
                  {actions.some((action) => action.status === "released") && !handoverPaymentReady ? (
                    <p className={styles.choosePrompt}>Handover is protected: the remaining balance must be recorded before “Released to Customer” becomes available.</p>
                  ) : null}
                  <p className={styles.choosePrompt}>
                    {selectedAction
                      ? `Reviewing "${selectedAction.label}" — complete the confirmation popup to apply it.`
                      : "Choose an action card to review its customer message before confirming."}
                  </p>
                </div>
              ) : <p className={styles.terminalNotice}>This booking is complete or closed. No further actions are available.</p>}
            </div>
            <section className={`${styles.customerNotification} ${bookingApproved ? styles.customerNotificationApproved : ""}`} aria-labelledby="customer-notification-heading">
              <div>
                <span>Customer Notification</span>
                <h2 id="customer-notification-heading">{bookingApproved ? "Booking Approved" : "Confirmation email available after approval"}</h2>
                <p>{bookingApproved ? `Send the approved booking summary directly to ${email === "-" ? "the customer" : email}. The email includes the booking number, rental details, dates, payment status, fulfillment method, and any remaining action.` : "Complete the approval step before sending the customer a booking confirmation email."}</p>
              </div>
              <div className={styles.customerNotificationAction}>
                <Button variant="none"
                  type="button"
                  className={styles.sendConfirmationButton}
                  onClick={() => void handleSendBookingConfirmationEmail()}
                  disabled={!bookingApproved || email === "-" || sendingConfirmationEmail}
                >
                  {sendingConfirmationEmail ? "Sending confirmation..." : "Send Booking Confirmation to Email"}
                </Button>
                {confirmationEmailSentAt ? <small>Last sent {formatDate(confirmationEmailSentAt, true)}</small> : null}
              </div>
            </section>
          </div>
        </section>

        <section id="booking-step-history" className={styles.detailSection} role="tabpanel" aria-labelledby="booking-tab-history" hidden={activeStep !== "history"}>
          <div className={styles.detailSectionHeader}>
            <span className={styles.sectionNumber}>07</span>
            <div><strong>Status Activity</strong><small>{statusHistory.length} recorded update{statusHistory.length === 1 ? "" : "s"}</small></div>
            <span className={styles.sectionHeaderStatus}>Audit trail</span>
          </div>
          <div className={styles.detailBody}>
            {statusHistory.length ? <ol className={styles.timeline}>{statusHistory.map((entry) => <li key={entry.id}><span aria-hidden="true" /><div><strong>{entry.fromStatus ? `${formatStatus(entry.fromStatus)} to ` : ""}{formatStatus(entry.toStatus)}</strong><p>{entry.note || "Status updated."}</p><small>{formatDate(entry.createdAt, true)} · {entry.changedByUserId ? "Recorded by account" : "Booking update"}</small></div></li>)}</ol> : <p className={styles.empty}>No status history is available.</p>}
          </div>
        </section>
      </div>

      {selectedAction ? (
        <ConfirmModal
          title={selectedAction.label}
          description={<>Apply this update to booking <strong>{booking.bookingRef}</strong>? {selectedAction.description}</>}
          confirmLabel={`Yes, ${selectedAction.label}`}
          busyLabel="Updating booking..."
          tone={selectedAction.tone === "danger" ? "danger" : "default"}
          onCancel={() => { setSelectedStatus(""); setNote(""); setDeclineReason(""); }}
          onConfirm={requestStatusAction}
          confirmDisabled={isDeclineAction ? declineIncomplete : (selectedAction.requiresNote && !note.trim())}
          busy={updating}
        >
          {isDeclineAction ? (
            <>
              <label>
                <span>Decline reason (required)</span>
                <select value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} disabled={updating}>
                  <option value="" disabled>Select a reason</option>
                  {DECLINE_REASON_OPTIONS.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
              </label>
              <label>
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
            <label>
              <span>Message to customer{selectedAction.requiresNote ? " (required)" : " (optional)"}</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000} placeholder={selectedAction.requiresNote ? "Explain the reason clearly before continuing" : "Add a helpful update or handover instruction"} disabled={updating} />
            </label>
          )}
          <div className={styles.confirmationSummary}>
            <span><strong>Booking:</strong> {booking.bookingRef}</span>
            <span><strong>Customer:</strong> {fullName}</span>
            <span><strong>Rental:</strong> {bookingHeadline(booking.items)}</span>
            <span><strong>Current status:</strong> {formatStatus(booking.status)}</span>
            <span>The customer&apos;s account and booking timeline will update immediately.</span>
          </div>
        </ConfirmModal>
      ) : null}

      {countersignConfirmationOpen ? (
        <ConfirmModal
          title="Finalize Rental Agreement?"
          description="Are you sure you want to countersign and finalize this rental agreement?"
          confirmLabel="Finalize Agreement"
          busyLabel="Finalizing agreement..."
          tone="danger"
          onCancel={() => setCountersignConfirmationOpen(false)}
          onConfirm={() => void confirmCountersignAgreement()}
          busy={countersigning}
        >
          <div className={styles.confirmationSummary}>
            <strong>Signing as {businessSignerName.trim()}</strong>
            <span><strong>Booking:</strong> {booking.bookingRef}</span>
            <span><strong>Customer:</strong> {fullName}</span>
            <span><strong>Rental:</strong> {bookingHeadline(booking.items)}</span>
            <span><strong>Current status:</strong> {formatStatus(booking.status)}</span>
            <span>This action is permanent and cannot be undone. The final PDF will be generated and made available to the customer immediately.</span>
          </div>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
