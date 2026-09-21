"use client";

import { Suspense, useCallback, useEffect, useState, type KeyboardEvent } from "react";
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
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";
import CustomerReviewPanel from "@/components/reviews/CustomerReviewPanel";
import CustomerBookingManagement from "@/components/booking-management/CustomerBookingManagement";
import { useBookingRealtime } from "@/hooks/useBookingRealtime";
import { bookingHeadline, bookingItemsSummaryData } from "@/src/lib/bookingDisplay";
import { formatManilaDateTime } from "@/src/lib/rentalTiming";
import GuestBookingRecoveryForm from "@/components/guest-booking/GuestBookingRecoveryForm";
import DocumentResubmission from "@/components/booking-management/DocumentResubmission";

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

const PANEL_ORDER: BookingPanel[] = ["overview", "progress", "documents", "updates"];

function getRequirementGuidance(status: string): string {
  switch (status) {
    case "approved":
      return "Approved and ready for the next step.";
    case "pending_review":
      return "Under review. No action needed right now.";
    case "rejected":
      return "Correct the flagged document below.";
    default:
      return "Submit verification documents to continue.";
  }
}

function getAgreementGuidance(status: string): string {
  switch (status) {
    case "completed":
      return "Signed and ready to view.";
    case "awaiting_business_signature":
      return "Your signature is complete. The business is finalizing the agreement.";
    case "awaiting_customer_signature":
      return "Review and sign to continue.";
    case "rejected":
      return "Needs attention. Contact the business for help.";
    default:
      return "Prepared after the earlier steps are complete.";
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
  const justRecovered = searchParams.get("recovered") === "1";

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

  function focusPanelTab(panel: BookingPanel) {
    window.requestAnimationFrame(() => document.getElementById(`booking-tab-${panel}`)?.focus());
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLButtonElement>, panel: BookingPanel) {
    const currentIndex = PANEL_ORDER.indexOf(panel);
    const nextIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % PANEL_ORDER.length
      : event.key === "ArrowLeft"
        ? (currentIndex - 1 + PANEL_ORDER.length) % PANEL_ORDER.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? PANEL_ORDER.length - 1
            : -1;

    if (nextIndex < 0) return;
    event.preventDefault();
    const nextPanel = PANEL_ORDER[nextIndex];
    selectPanel(nextPanel);
    focusPanelTab(nextPanel);
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

  useBookingRealtime({
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
      <GuestBookingRecoveryForm />
    ) : null;
  }

  if (guestMode && !user.is_anonymous) {
    return (
      <section className={styles.guestSessionCard}>
        <p className={styles.sectionEyebrow}>CUSTOMER ACCOUNT ACTIVE</p>
        <h1>This link is for a guest booking.</h1>
        <p>
          Your signed-in rentals are available under My Bookings. To recover a separate guest
          checkout, sign out first, then reopen Track Guest Booking and verify its checkout details.
        </p>
        <Button href="/account/bookings" variant="primary" className={styles.backLink}>
          Open My Bookings
        </Button>
      </section>
    );
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
    return guestMode ? (
      <GuestBookingRecoveryForm hasGuestSession />
    ) : <p className={formStyles.errorText}>We couldn&apos;t find that booking.</p>;
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
        ? "Verified and recorded."
        : "Submit payment proof to reserve these dates.",
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
        ? "Confirmed. See updates for pickup or delivery."
        : "Confirmation follows the steps above.",
      state: COMPLETED_BOOKING_STATUSES.has(booking.status) ? "complete" : "upcoming",
    },
  ] as const;
  const completedSteps = processSteps.filter((step) => step.state === "complete").length;
  const completionPercentage = Math.round((completedSteps / processSteps.length) * 100);
  const issuedReceipts = receipts.filter((receipt) => Boolean(receipt.documentPath));
  const agreementDocumentPath = agreement?.finalDocumentPath ?? agreement?.generatedDocumentPath;
  const documentCount = documents.length + issuedReceipts.length + (agreementDocumentPath ? 1 : 0);
  const rentalStart = formatManilaDateTime(new Date(booking.startDate));
  const rentalEnd = formatManilaDateTime(new Date(booking.endDate));
  const durationLabel = booking.dayCount === 1 ? "22 hours" : `${booking.dayCount} days`;

  return (
    <div className={styles.wrapper}>
      <Link href={guestMode ? "/guest/bookings" : "/account/bookings"} className={styles.backLink}>
        <span aria-hidden="true">←</span> {guestMode ? "Back to Guest Bookings" : "Back to My Bookings"}
      </Link>

      {justRecovered ? (
        <div className={styles.confirmationBanner} role="status">
          <h2>Guest access restored.</h2>
          <p>
            This browser can now securely track <strong>{booking.bookingRef}</strong>. Keep your
            checkout details nearby if you need to restore access.
          </p>
        </div>
      ) : justSubmitted ? (
        <div className={styles.confirmationBanner}>
          <h2>Your reservation is secured and submitted successfully.</h2>
          <p>
            {isDemoPayment
              ? "Demo payment recorded. No real money was processed."
              : "Your GCash proof was submitted for review. We will update your booking after verification."}
          </p>
          <p className={styles.paymentNote}>
            Invoices, receipts, agreements, and balance payment are available from Documents and Overview.
          </p>
        </div>
      ) : hasVerifiedPayment ? (
        <div className={styles.confirmationBanner}>
          <h2>Payment verified — your dates are reserved.</h2>
          <p>
            Payment for <strong>{booking.bookingRef}</strong> is verified. Your rental dates are reserved.
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
              This secure page stays available in the checkout browser through completion. Keep <strong>{booking.bookingRef}</strong>
              and do not clear this site&apos;s data until the rental is finished.
            </p>
          </div>
          <div className={styles.guestPerksNote}>
            <strong>Want perks on future rentals?</strong>
            <span>
              Accounts receive birthday-month and 11th-rental rewards. Guest bookings do not earn either perk.
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
            <div className={styles.headerDates} aria-label="Rental dates">
              <span><small>Pickup</small><strong>{rentalStart}</strong></span>
              <span className={styles.headerDateArrow} aria-hidden="true">→</span>
              <span><small>Return</small><strong>{rentalEnd}</strong></span>
            </div>
            <p className={styles.createdDate}>Created {new Date(booking.createdAt).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}</p>
          </div>
          <div className={styles.headerStatusGroup}>
            <StatusBadge status={booking.status} />
          </div>
        </div>

      </header>

        <nav className={styles.sectionNav} aria-label="Booking detail sections" role="tablist">
           <Button id="booking-tab-overview" variant="none" type="button" role="tab" aria-controls="booking-overview" aria-selected={activePanel === "overview"} tabIndex={activePanel === "overview" ? 0 : -1} onKeyDown={(event) => handlePanelKeyDown(event, "overview")} onClick={() => selectPanel("overview")}>
             <span>01</span><strong>Overview</strong><small>Dates &amp; payment</small>
           </Button>
           <Button id="booking-tab-progress" variant="none" type="button" role="tab" aria-controls="process-completion" aria-selected={activePanel === "progress"} tabIndex={activePanel === "progress" ? 0 : -1} onKeyDown={(event) => handlePanelKeyDown(event, "progress")} onClick={() => selectPanel("progress")}>
             <span>02</span><strong>Progress</strong><small>Manage booking</small>
           </Button>
           <Button id="booking-tab-documents" variant="none" type="button" role="tab" aria-controls="booking-documents" aria-selected={activePanel === "documents"} tabIndex={activePanel === "documents" ? 0 : -1} onKeyDown={(event) => handlePanelKeyDown(event, "documents")} onClick={() => selectPanel("documents")}>
             <span>03</span><strong>Documents</strong><small>Files &amp; records</small>
           </Button>
           <Button id="booking-tab-updates" variant="none" type="button" role="tab" aria-controls="booking-notifications" aria-selected={activePanel === "updates"} tabIndex={activePanel === "updates" ? 0 : -1} onKeyDown={(event) => handlePanelKeyDown(event, "updates")} onClick={() => selectPanel("updates")}>
             <span>04</span><strong>Updates</strong><small>Live messages</small>
           </Button>
         </nav>

      <section className={styles.bookingStepper} aria-labelledby="booking-stepper-heading">
        <div className={styles.stepperHeading}>
          <div>
            <p>BOOKING PATH</p>
            <h2 id="booking-stepper-heading">{completedSteps} of {processSteps.length} steps complete</h2>
          </div>
          <strong>{completionPercentage}%</strong>
        </div>
        <div className={styles.stepperProgressTrack} aria-label={`${completionPercentage}% complete`}>
            <span style={{ width: `${completionPercentage}%` }} />
        </div>
        <ol className={styles.stepperList}>
          {processSteps.map((step, index) => (
            <li key={step.label} className={styles[step.state]}>
              <span className={styles.stepMarker} aria-hidden="true">{step.state === "complete" ? "✓" : index + 1}</span>
              <div className={styles.stepContent}><strong>{step.label}</strong><span>{step.value}</span><small>{step.help}</small></div>
            </li>
          ))}
        </ol>
      </section>

      <div
        id="booking-overview"
        role="tabpanel"
        aria-labelledby="booking-tab-overview"
        tabIndex={0}
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

           <section className={styles.logisticsCard} aria-labelledby="rental-dates-heading">
             <div className={styles.datesHeading}>
               <div>
                 <p>RENTAL DATES</p>
                 <h3 id="rental-dates-heading">Your reserved time</h3>
               </div>
               <span className={styles.dateDuration}>{durationLabel}</span>
             </div>
             <div className={styles.dateSummary}>
               <div><span>Pickup</span><strong>{rentalStart}</strong></div>
               <span className={styles.dateArrow} aria-hidden="true">→</span>
               <div><span>Return</span><strong>{rentalEnd}</strong></div>
             </div>
             <details className={styles.disclosure}>
               <summary>More information</summary>
               <dl className={styles.logisticsGrid}>
                 <div><dt>Duration</dt><dd>{durationLabel}</dd></div>
                 <div><dt>Fulfillment</dt><dd>{booking.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"}</dd></div>
                 <div><dt>Location</dt><dd>{booking.location ?? (booking.fulfillmentMethod === "pickup" ? "Business pickup point" : "Address pending")}</dd></div>
               </dl>
             </details>
           </section>

           <details className={styles.disclosureCard}>
             <summary>View booking details</summary>
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
           </details>

          {booking.requirementsStatus === "not_submitted" ? (
            <section className={styles.continueCard}>
              <span className={styles.continueIcon} aria-hidden="true">→</span>
              <div>
                <h3>Continue your booking</h3>
                <p>Complete the next guided step so the team can review and confirm your reservation.</p>
              </div>
              <Button
                href={`/catalog/${booking.productId}/reserve?bookingId=${booking.id}`}
                variant="primary"
              >
                Continue Booking
              </Button>
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
        aria-labelledby="booking-tab-progress"
        tabIndex={0}
        className={styles.panelContent}
        hidden={activePanel !== "progress"}
      >
      <CustomerBookingManagement
        booking={booking}
        payments={payments}
        documents={documents}
        agreement={agreement}
        statusHistory={statusHistory}
        showTimeline={false}
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
          <Button href="#booking-documents" variant="secondary" onClick={() => { selectPanel("documents"); focusPanelTab("documents"); }}>
            Open Documents to resubmit
          </Button>
        </section>
      ) : null}
      </div>

      <div
        id="booking-documents"
        role="tabpanel"
        aria-labelledby="booking-tab-documents"
        tabIndex={0}
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
                <Button variant="none" type="button" onClick={() => openBookingFile("agreements", agreementDocumentPath)}>
                  <span className={styles.documentIcon} aria-hidden="true">PDF</span>
                  <span className={styles.documentInfo}>
                    <strong>{agreement?.finalDocumentPath ? "Signed Rental Agreement" : "Rental Agreement"}</strong>
                    <small>Open secure PDF</small>
                  </span>
                  <span className={`${styles.documentStatus} ${agreement?.finalDocumentPath ? styles.approved : styles.pending}`}>
                    {agreement?.finalDocumentPath ? "Completed" : "Prepared"}
                  </span>
                </Button>
              </li>
            ) : null}
            {issuedReceipts.map((receipt) => (
              <li key={receipt.id}>
                <Button variant="none" type="button" onClick={() => openBookingFile("receipts", receipt.documentPath!)}>
                  <span className={styles.documentIcon} aria-hidden="true">PDF</span>
                  <span className={styles.documentInfo}>
                    <strong>Official Receipt {receipt.receiptNumber}</strong>
                    <small>Issued {new Date(receipt.issuedAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</small>
                  </span>
                  <span className={`${styles.documentStatus} ${styles.approved}`}>Issued</span>
                </Button>
              </li>
            ))}
            {documents.map((document) => (
              <li key={document.id} className={styles.documentRow}>
                <Button variant="none"
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
                </Button>
                {document.reviewStatus === "rejected" ? (
                  <div className={styles.rejectedDocumentDetails}>
                    <span className={styles.rejectedDocumentReason}>
                      <strong>Rejected</strong>{document.reviewNotes || "Please upload a corrected file for review."}
                    </span>
                    <DocumentResubmission bookingId={booking.id} document={document} onSubmitted={loadDetails} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>

      <div
        id="booking-notifications"
        role="tabpanel"
        aria-labelledby="booking-tab-updates"
        tabIndex={0}
        className={styles.panelContent}
        hidden={activePanel !== "updates"}
      >
      <section className={styles.resourceSection}>
        <div className={styles.resourceHeading}>
          <div>
            <p className={styles.sectionEyebrow}>BOOKING UPDATES</p>
            <h2>Notifications</h2>
          </div>
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
