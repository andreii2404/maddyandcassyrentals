"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/src/lib/supabase/client";
import {
  getBookingDetails,
  getBookingFileUrl,
  type BookingDetails,
} from "@/src/services/bookingDetailService";
import BookingItemsSummary from "@/components/booking-summary/BookingItemsSummary";
import StatusBadge from "@/components/status-badge/StatusBadge";
import NotificationList from "@/components/notification-list/NotificationList";
import Spinner from "@/components/ui/Spinner";
import formStyles from "@/components/ui/Form.module.css";
import styles from "./bookingDetail.module.css";
import BookingPaymentPanel from "@/components/payment/BookingPaymentPanel";
import { useToast } from "@/components/ui/ToastProvider";
import CustomerReviewPanel from "@/components/reviews/CustomerReviewPanel";
import CustomerBookingManagement from "@/components/booking-management/CustomerBookingManagement";
import {
  getBookingLiveStatusLabel,
  useBookingRealtime,
} from "@/hooks/useBookingRealtime";
import { bookingHeadline, bookingItemsSummaryData } from "@/src/lib/bookingDisplay";
import { formatManilaDateTime } from "@/src/lib/rentalTiming";

const REQUIREMENTS_STATUS_LABEL: Record<string, string> = {
  not_submitted: "Not Submitted",
  pending_review: "Pending Review",
  approved: "Approved",
  rejected: "Rejected",
};

const AGREEMENT_STATUS_LABEL: Record<string, string> = {
  not_created: "Not Created",
  awaiting_customer_signature: "Awaiting Your Signature",
  awaiting_business_signature: "Awaiting Business Signature",
  completed: "Completed",
  rejected: "Rejected",
};

const COMPLETED_BOOKING_STATUSES = new Set([
  "confirmed",
  "ready_for_release",
  "released",
  "returned",
]);

type BookingPanel = "overview" | "progress" | "documents" | "updates";

const PANEL_HASHES: Record<BookingPanel, string> = {
  overview: "#booking-overview",
  progress: "#process-completion",
  documents: "#booking-documents",
  updates: "#booking-notifications",
};

function getRequirementGuidance(status: string): string {
  switch (status) {
    case "approved":
      return "Your identity documents have been reviewed and accepted.";
    case "pending_review":
      return "Your documents are with the team for review. No action is needed right now.";
    case "rejected":
      return "One or more documents need to be corrected. See the review notes below.";
    default:
      return "Submit the requested verification documents to continue.";
  }
}

function getAgreementGuidance(status: string): string {
  switch (status) {
    case "completed":
      return "The rental agreement has all required signatures and is ready to view.";
    case "awaiting_business_signature":
      return "Your part is complete—no action is needed from you. An administrator will finish reviewing your documents, countersign the agreement, and notify you when the final PDF is ready.";
    case "awaiting_customer_signature":
      return "Review and sign the rental agreement to continue your booking.";
    case "rejected":
      return "The agreement needs attention. Please contact the business for assistance.";
    default:
      return "Your agreement will be prepared after the required booking steps.";
  }
}

function formatDocumentType(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function BookingDetailPage() {
  return (
    <Suspense fallback={null}>
      <BookingDetailContent />
    </Suspense>
  );
}

export function BookingDetailContent({ guestMode = false }: { guestMode?: boolean }) {
  const { user, loading: authLoading } = useAuth();
  const params = useParams<{ bookingId: string }>();
  const searchParams = useSearchParams();
  const justSubmitted = searchParams.get("justSubmitted") === "1";

  const [details, setDetails] = useState<BookingDetails | null | "error">(null);
  const [activePanel, setActivePanel] = useState<BookingPanel>("overview");
  const { showToast } = useToast();

  useEffect(() => {
    function syncPanelFromHash() {
      const matched = (Object.entries(PANEL_HASHES) as Array<[BookingPanel, string]>).find(
        ([, hash]) => hash === window.location.hash,
      );
      if (matched) setActivePanel(matched[0]);
    }

    syncPanelFromHash();
    window.addEventListener("hashchange", syncPanelFromHash);
    return () => window.removeEventListener("hashchange", syncPanelFromHash);
  }, []);

  function selectPanel(panel: BookingPanel) {
    setActivePanel(panel);
    window.history.replaceState(null, "", PANEL_HASHES[panel]);
  }

  const loadDetails = useCallback(async () => {
    try {
      const result = await getBookingDetails(createClient(), params.bookingId);
      setDetails(result ?? "error");
    } catch {
      setDetails("error");
    }
  }, [params.bookingId]);

  async function openBookingFile(
    bucket: Parameters<typeof getBookingFileUrl>[1],
    storagePath: string,
  ) {
    try {
      const url = await getBookingFileUrl(createClient(), bucket, storagePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      showToast("This document could not be opened.", "error");
    }
  }

  useEffect(() => {
    if (!user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDetails();
  }, [loadDetails, user]);

  const liveStatus = useBookingRealtime({
    bookingId: params.bookingId,
    enabled: Boolean(user),
    onChange: loadDetails,
  });

  if (authLoading) {
    return (
      <div className={styles.loading}>
        <Spinner label="Loading booking" />
      </div>
    );
  }

  if (!user) {
    return guestMode ? (
      <section className={styles.guestSessionCard}>
        <p className={styles.sectionEyebrow}>GUEST BOOKING ACCESS</p>
        <h1>Open this booking from the checkout browser.</h1>
        <p>
          Guest tracking is protected by the temporary session created during checkout. Return
          to the same browser and device without clearing site data, then open your tracking link
          again. Your booking has not been cancelled or removed.
        </p>
        <p>
          If that browser is no longer available, contact Rental by Maddy &amp; Cassy and provide
          your booking reference and the email used at checkout so the team can verify you.
        </p>
        <Link href="/contact" className={formStyles.primaryButton}>Contact Support</Link>
      </section>
    ) : null;
  }

  if (details === null) {
    return (
      <div className={styles.loading}>
        <Spinner label="Loading booking" />
      </div>
    );
  }

  if (
    details === "error" ||
    details.booking.customerId !== user.id ||
    (guestMode && !details.booking.isGuestCheckout)
  ) {
    return <p className={formStyles.errorText}>We couldn&apos;t find that booking.</p>;
  }

  const { booking, agreement, documents, payments, receipts, statusHistory } = details;
  const itemsSummary = bookingItemsSummaryData(booking, agreement);
  const isDemoPayment = payments.some((p) => (p.providerMetadata as { demo?: boolean } | undefined)?.demo === true);
  const customerSignature = agreement?.signatures?.find((s) => s.signerRole === "customer");
  const rejectedDocuments = documents.filter((d) => d.reviewStatus === "rejected");
  const hasVerifiedPayment = payments.some((payment) => payment.status === "verified");
  const processSteps = [
    {
      label: "Payment",
      value: hasVerifiedPayment ? "Verified" : "Not yet verified",
      help: hasVerifiedPayment
        ? "Your payment was securely verified and recorded."
        : "Complete or resume your secure payment to reserve the selected dates.",
      state: hasVerifiedPayment ? "complete" : "current",
    },
    {
      label: "Documents",
      value: REQUIREMENTS_STATUS_LABEL[booking.requirementsStatus],
      help: getRequirementGuidance(booking.requirementsStatus),
      state: booking.requirementsStatus === "approved"
        ? "complete"
        : booking.requirementsStatus === "rejected"
          ? "attention"
          : booking.requirementsStatus === "pending_review"
            ? "current"
            : "upcoming",
    },
    {
      label: "Agreement",
      value: AGREEMENT_STATUS_LABEL[booking.agreementStatus],
      help: getAgreementGuidance(booking.agreementStatus),
      state: booking.agreementStatus === "completed"
        ? "complete"
        : booking.agreementStatus === "rejected"
          ? "attention"
          : booking.agreementStatus === "not_created"
            ? "upcoming"
            : "current",
    },
    {
      label: "Confirmation",
      value: COMPLETED_BOOKING_STATUSES.has(booking.status) ? "Confirmed" : "In progress",
      help: COMPLETED_BOOKING_STATUSES.has(booking.status)
        ? "The booking is confirmed. Follow the tracker above for pickup or delivery updates."
        : "The business confirms the booking after payment, documents, and agreement are complete.",
      state: COMPLETED_BOOKING_STATUSES.has(booking.status) ? "complete" : "upcoming",
    },
  ] as const;
  const completedSteps = processSteps.filter((step) => step.state === "complete").length;
  const completionPercentage = Math.round((completedSteps / processSteps.length) * 100);
  const issuedReceipts = receipts.filter((receipt) => Boolean(receipt.documentPath));
  const agreementDocumentPath = agreement?.finalDocumentPath ?? agreement?.generatedDocumentPath;
  const documentCount = documents.length + issuedReceipts.length + (agreementDocumentPath ? 1 : 0);

  return (
    <div className={styles.wrapper}>
      <Link href={guestMode ? "/guest/bookings" : "/account/bookings"} className={styles.backLink}>
        <span aria-hidden="true">←</span> {guestMode ? "Back to Guest Bookings" : "Back to My Bookings"}
      </Link>

      {justSubmitted ? (
        <div className={styles.confirmationBanner}>
          <h2>Your reservation is secured and submitted successfully.</h2>
          <p>
            {isDemoPayment
              ? "This booking completed the development payment flow. No real money was processed. The business can now test document review and confirmation."
              : "Your GCash payment proof has been submitted. Once our team verifies it, we'll review your verification documents and signed agreement, then mark the booking Confirmed."}
          </p>
          <p className={styles.paymentNote}>
            Your invoice, official receipt, verified proof of payment, and signed rental agreement
            are available under Documents below. If you selected the 50% option, you can pay the
            remaining balance from this tracking page.
          </p>
        </div>
      ) : hasVerifiedPayment ? (
        <div className={styles.confirmationBanner}>
          <h2>Payment verified — your dates are reserved.</h2>
          <p>
            Your payment for booking <strong>{booking.bookingRef}</strong> has been verified.{" "}
            {formatManilaDateTime(new Date(booking.startDate))} to {formatManilaDateTime(new Date(booking.endDate))} is reserved for you.
          </p>
          <p className={styles.paymentNote}>
            Your official receipt is available under Documents below.
          </p>
        </div>
      ) : null}

      {guestMode ? (
        <section className={styles.guestAccessBanner} aria-labelledby="guest-access-heading">
          <div className={styles.guestAccessIcon} aria-hidden="true">G</div>
          <div>
            <p className={styles.sectionEyebrow}>GUEST TRACKING</p>
            <h2 id="guest-access-heading">No customer account is required.</h2>
            <p>
              This secure page remains available in the browser used for checkout through payment,
              review, confirmation, pickup or delivery, and completion. Keep <strong>{booking.bookingRef}</strong>
              and do not clear this site&apos;s data until the rental is finished.
            </p>
          </div>
          <div className={styles.guestPerksNote}>
            <strong>Want perks on future rentals?</strong>
            <span>
              Customer accounts receive birthday-month and 11th-rental rewards. Guest bookings do
              not earn either perk, and creating an account is completely optional.
            </span>
            {booking.status === "returned" ? (
              <Link href="/sign-up">Create an Account</Link>
            ) : (
              <small>Create one after this rental is complete so this guest tracking session stays uninterrupted.</small>
            )}
          </div>
        </section>
      ) : null}

      <header className={styles.bookingHeader}>
        <div className={styles.headerRow}>
          <div>
            <p className={styles.eyebrow}>BOOKING DETAILS <span>•</span> {booking.bookingRef}</p>
            <h1 className={styles.heading}>{bookingHeadline(booking.items)}</h1>
            <p>Created {new Date(booking.createdAt).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}</p>
          </div>
          <div className={styles.headerStatusGroup}>
            <span className={`${styles.liveStatus} ${styles[liveStatus]}`}>
              <span aria-hidden="true" />{getBookingLiveStatusLabel(liveStatus)}
            </span>
            <StatusBadge status={booking.status} />
          </div>
        </div>

      </header>

        <nav className={styles.sectionNav} aria-label="Booking detail sections" role="tablist">
          <button type="button" role="tab" aria-selected={activePanel === "overview"} onClick={() => selectPanel("overview")}>
            <span>01</span><strong>Overview</strong><small>Rental &amp; payment</small>
          </button>
          <button type="button" role="tab" aria-selected={activePanel === "progress"} onClick={() => selectPanel("progress")}>
            <span>02</span><strong>Progress</strong><small>{completedSteps} of {processSteps.length} steps</small>
          </button>
          <button type="button" role="tab" aria-selected={activePanel === "documents"} onClick={() => selectPanel("documents")}>
            <span>03</span><strong>Documents</strong><small>{documentCount} available</small>
          </button>
          <button type="button" role="tab" aria-selected={activePanel === "updates"} onClick={() => selectPanel("updates")}>
            <span>04</span><strong>Updates</strong><small>Live notifications</small>
          </button>
        </nav>

      <section className={styles.quickTracker} aria-label="Booking process summary">
        <div className={styles.quickTrackerHeading}>
          <div>
            <p>BOOKING PROGRESS</p>
            <strong>{completionPercentage}% complete</strong>
          </div>
          <div className={styles.quickProgressTrack} aria-label={`${completionPercentage}% complete`}>
            <span style={{ width: `${completionPercentage}%` }} />
          </div>
          <button type="button" onClick={() => selectPanel("progress")}>View full tracker →</button>
        </div>
        <ol>
          {processSteps.map((step, index) => (
            <li key={step.label} className={styles[step.state]}>
              <span aria-hidden="true">{step.state === "complete" ? "✓" : index + 1}</span>
              <div><strong>{step.label}</strong><small>{step.value}</small></div>
            </li>
          ))}
        </ol>
      </section>

      <div
        id="booking-overview"
        role="tabpanel"
        className={styles.panelContent}
        hidden={activePanel !== "overview"}
      >
      <div className={styles.bookingWorkspace}>
        <div className={styles.overviewColumn}>
          <div className={styles.contentHeading}>
            <div>
              <p>RENTAL OVERVIEW</p>
              <h2>Your booking at a glance</h2>
            </div>
            <Link href="/catalog" className={styles.browseLink}>Browse more rentals</Link>
          </div>

          <div className={styles.logisticsCard}>
            <dl className={styles.logisticsGrid}>
              <div>
                <dt>Pickup</dt>
                <dd>{formatManilaDateTime(new Date(booking.startDate))}</dd>
              </div>
              <div>
                <dt>Return</dt>
                <dd>{formatManilaDateTime(new Date(booking.endDate))}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{booking.dayCount === 1 ? "22 hours" : `${booking.dayCount} days`}</dd>
              </div>
              <div>
                <dt>Fulfillment</dt>
                <dd>{booking.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{booking.location ?? (booking.fulfillmentMethod === "pickup" ? "Business pickup point" : "Address pending")}</dd>
              </div>
            </dl>
          </div>

          <BookingItemsSummary
            currency={booking.productSnapshot.currency || "PHP"}
            items={itemsSummary.items}
            unitsExpected={itemsSummary.unitsExpected}
            subtotal={booking.rentalSubtotal}
            discountAmount={booking.specialDiscountAmount}
            depositAmount={booking.refundableDeposit}
            fees={booking.deliveryFee + (booking.pickupConvenienceFee ?? 0)}
            grandTotal={booking.totalAmount}
          />

          {booking.requirementsStatus === "not_submitted" ? (
            <section className={styles.continueCard}>
              <span className={styles.continueIcon} aria-hidden="true">→</span>
              <div>
                <h3>Continue your booking</h3>
                <p>Complete the next guided step so the team can review and confirm your reservation.</p>
              </div>
              <Link
                href={`/catalog/${booking.productId}/reserve?bookingId=${booking.id}`}
                className={formStyles.primaryButton}
              >
                Continue Booking
              </Link>
            </section>
          ) : null}
        </div>

        <aside className={styles.paymentColumn}>
          <BookingPaymentPanel booking={booking} payments={payments} onPaymentUpdated={loadDetails} />
        </aside>
      </div>

      {booking.status === "returned" ? (
        <section className={styles.section}>
          <h3>Rate Your Rental</h3>
          <CustomerReviewPanel
            bookingId={booking.id}
            productId={booking.productId}
            productName={booking.productSnapshot.name}
            existingReview={details.review}
            onSubmitted={loadDetails}
          />
        </section>
      ) : null}
      </div>

      <div
        id="process-completion"
        role="tabpanel"
        className={styles.panelContent}
        hidden={activePanel !== "progress"}
      >
      <section className={styles.processSection}>
        <div className={styles.processHeader}>
          <div>
            <p className={styles.sectionEyebrow}>PROCESS COMPLETION</p>
            <h2>Know what is done and what comes next</h2>
            <span>{completedSteps} of {processSteps.length} essential steps complete</span>
          </div>
          <strong>{completionPercentage}%</strong>
        </div>
        <div className={styles.progressTrack} aria-label={`${completionPercentage}% complete`}>
          <span style={{ width: `${completionPercentage}%` }} />
        </div>
        <ol className={styles.processGrid}>
          {processSteps.map((step, index) => (
            <li key={step.label} className={styles[step.state]}>
              <div className={styles.stepTopline}>
                <span className={styles.stepIcon} aria-hidden="true">
                  {step.state === "complete" ? "✓" : index + 1}
                </span>
                <span className={styles.stepState}>
                  {step.state === "complete" ? "Complete" : step.state === "attention" ? "Action needed" : step.state === "current" ? "In progress" : "Upcoming"}
                </span>
              </div>
              <h3>{step.label}</h3>
              <strong>{step.value}</strong>
              <p>{step.help}</p>
            </li>
          ))}
        </ol>
      </section>

      <CustomerBookingManagement
        booking={booking}
        payments={payments}
        documents={documents}
        agreement={agreement}
        statusHistory={statusHistory}
        onUpdated={loadDetails}
      />

      {rejectedDocuments.length ? (
        <section className={styles.correctionSection}>
          <h3>Document Correction Needed</h3>
          {rejectedDocuments.map((document) => (
            <p key={document.id} className={styles.remarks}>
              <strong>{formatDocumentType(document.documentType)}:</strong>{" "}
              {document.reviewNotes || "Please contact the business for details on this rejection."}
            </p>
          ))}
        </section>
      ) : null}
      </div>

      <div
        id="booking-documents"
        role="tabpanel"
        className={styles.panelContent}
        hidden={activePanel !== "documents"}
      >
      <section className={styles.resourceSection}>
        <div className={styles.resourceHeading}>
          <div>
            <p className={styles.sectionEyebrow}>DOCUMENT CENTER</p>
            <h2>Documents</h2>
          </div>
          <span>{documentCount} file{documentCount === 1 ? "" : "s"}</span>
        </div>
        <p className={styles.sectionIntro}>Review submitted files, their approval status, and your completed booking records.</p>
        {documentCount === 0 ? (
          <div className={styles.emptyState}>
            <span aria-hidden="true">□</span>
            <div><strong>No documents yet</strong><p>Your verification files and completed records will appear here.</p></div>
          </div>
        ) : (
          <ul className={styles.documentList}>
            {agreementDocumentPath ? (
              <li>
                <button type="button" onClick={() => openBookingFile("agreements", agreementDocumentPath)}>
                  <span className={styles.documentIcon} aria-hidden="true">PDF</span>
                  <span className={styles.documentInfo}>
                    <strong>{agreement?.finalDocumentPath ? "Signed Rental Agreement" : "Rental Agreement"}</strong>
                    <small>Open secure PDF</small>
                  </span>
                  <span className={`${styles.documentStatus} ${agreement?.finalDocumentPath ? styles.approved : styles.pending}`}>
                    {agreement?.finalDocumentPath ? "Completed" : "Prepared"}
                  </span>
                </button>
              </li>
            ) : null}
            {issuedReceipts.map((receipt) => (
              <li key={receipt.id}>
                <button type="button" onClick={() => openBookingFile("receipts", receipt.documentPath!)}>
                  <span className={styles.documentIcon} aria-hidden="true">PDF</span>
                  <span className={styles.documentInfo}>
                    <strong>Official Receipt {receipt.receiptNumber}</strong>
                    <small>Issued {new Date(receipt.issuedAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</small>
                  </span>
                  <span className={`${styles.documentStatus} ${styles.approved}`}>Issued</span>
                </button>
              </li>
            ))}
            {documents.map((document) => (
              <li key={document.id}>
                <button
                  type="button"
                  onClick={() => openBookingFile(
                    document.storageBucket as Parameters<typeof getBookingFileUrl>[1],
                    document.storagePath,
                  )}
                >
                  <span className={styles.documentIcon} aria-hidden="true">DOC</span>
                  <span className={styles.documentInfo}>
                    <strong>{formatDocumentType(document.documentType)}</strong>
                    <small>Open secure document</small>
                  </span>
                  <span className={`${styles.documentStatus} ${styles[document.reviewStatus]}`}>
                    {formatDocumentType(document.reviewStatus)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>

      <div
        id="booking-notifications"
        role="tabpanel"
        className={styles.panelContent}
        hidden={activePanel !== "updates"}
      >
      <section className={styles.resourceSection}>
        <div className={styles.resourceHeading}>
          <div>
            <p className={styles.sectionEyebrow}>BOOKING UPDATES</p>
            <h2>Notifications</h2>
          </div>
          <span>Live</span>
        </div>
        <p className={styles.sectionIntro}>See review decisions, confirmation messages, and fulfillment updates in one place.</p>
        <NotificationList uid={user.id} />
      </section>
      </div>

      {agreement && customerSignature ? (
        <p className={styles.footnote}>
          Signed by {customerSignature.signerName} on{" "}
          {new Date(customerSignature.signedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}
