"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/src/lib/supabase/client";
import {
  getBookingDetails,
  getBookingFileUrl,
  type BookingDetails,
} from "@/src/services/bookingDetailService";
import BookingSummaryCard from "@/components/booking-summary/BookingSummaryCard";
import StatusBadge from "@/components/status-badge/StatusBadge";
import NotificationList from "@/components/notification-list/NotificationList";
import Spinner from "@/components/ui/Spinner";
import formStyles from "@/components/ui/Form.module.css";
import styles from "./bookingDetail.module.css";
import BookingPaymentPanel from "@/components/payment/BookingPaymentPanel";
import { useToast } from "@/components/ui/ToastProvider";
import CustomerReviewPanel from "@/components/reviews/CustomerReviewPanel";
import CustomerBookingManagement from "@/components/booking-management/CustomerBookingManagement";

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

function BookingDetailContent() {
  const { user } = useAuth();
  const params = useParams<{ bookingId: string }>();
  const searchParams = useSearchParams();
  const justSubmitted = searchParams.get("justSubmitted") === "1";

  const [details, setDetails] = useState<BookingDetails | null | "error">(null);
  const { showToast } = useToast();

  async function loadDetails() {
    try {
      const result = await getBookingDetails(createClient(), params.bookingId);
      setDetails(result ?? "error");
    } catch {
      setDetails("error");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.bookingId]);

  if (!user || details === null) {
    return (
      <div className={styles.loading}>
        <Spinner label="Loading booking" />
      </div>
    );
  }

  if (details === "error" || details.booking.customerId !== user.id) {
    return <p className={formStyles.errorText}>We couldn&apos;t find that booking.</p>;
  }

  const { booking, agreement, documents, payments, statusHistory } = details;
  const isDemoPayment = payments.some((p) => (p.providerMetadata as { demo?: boolean } | undefined)?.demo === true);
  const customerSignature = agreement?.signatures?.find((s) => s.signerRole === "customer");
  const rejectedDocuments = documents.filter((d) => d.reviewStatus === "rejected");

  return (
    <div className={styles.wrapper}>
      <Link href="/account/bookings" className={styles.backLink}>← Back to booking history</Link>

      {justSubmitted ? (
        <div className={styles.confirmationBanner}>
          <h2>Your reservation is secured and submitted successfully.</h2>
          <p>
            {isDemoPayment
              ? "This booking completed the development payment flow. No real money was processed. The business can now test document review and confirmation."
              : "PayMongo has verified your reservation payment. The business will now review your verification documents and signed agreement, then mark the booking Confirmed."}
          </p>
          <p className={styles.paymentNote}>
            Your invoice, official receipt, verified proof of payment, and signed rental agreement
            are available under Documents. If you selected the 50% option, you can pay the
            remaining balance from this page.
          </p>
        </div>
      ) : null}

      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>BOOKING DETAILS · {booking.bookingRef}</p>
          <h1 className={styles.heading}>{booking.productSnapshot.name}</h1>
          <p>Created {new Date(booking.createdAt).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}</p>
        </div>
        <Link href="/catalog" className={styles.browseLink}>Browse more rentals</Link>
      </div>

      <CustomerBookingManagement
        booking={booking}
        payments={payments}
        documents={documents}
        agreement={agreement}
        statusHistory={statusHistory}
        onUpdated={loadDetails}
      />

      <BookingSummaryCard
        productName={booking.productSnapshot.name}
        brand={booking.productSnapshot.brand}
        productImage={booking.productSnapshot.image}
        pricePerDay={booking.productSnapshot.pricePerDay}
        currency={booking.productSnapshot.currency}
        startDate={new Date(booking.startDate)}
        endDate={new Date(booking.endDate)}
        dayCount={booking.dayCount}
        quantity={booking.quantity}
        fulfillmentMethod={booking.fulfillmentMethod}
        customerLocation={booking.location ?? ""}
      />

      {booking.requirementsStatus === "not_submitted" ? (
        <section className={styles.section}>
          <h3>Finish this booking</h3>
          <p>
            Continue the guided flow to complete payment, verification documents, and the signed
            rental agreement.
          </p>
          <Link
            href={`/catalog/${booking.productId}/reserve?bookingId=${booking.id}`}
            className={formStyles.primaryButton}
          >
            Continue Booking
          </Link>
        </section>
      ) : null}

      <BookingPaymentPanel booking={booking} payments={payments} />

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

      <section className={styles.section}>
        <h3>Process Completion</h3>
        <dl className={styles.detailGrid}>
          <div>
            <dt>Booking Status</dt>
            <dd><StatusBadge status={booking.status} /></dd>
          </div>
          <div>
            <dt>Requirements Status</dt>
            <dd>{REQUIREMENTS_STATUS_LABEL[booking.requirementsStatus]}</dd>
          </div>
          <div>
            <dt>Agreement Status</dt>
            <dd>{AGREEMENT_STATUS_LABEL[booking.agreementStatus]}</dd>
          </div>
        </dl>
      </section>

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

      <section className={styles.section}>
        <h3>Documents</h3>
        {documents.length === 0 ? (
          <p className={styles.emptyDocs}>
            Documents will appear here once submitted.
          </p>
        ) : (
          <ul className={styles.documentList}>
            {documents.map((document) => (
              <li key={document.id}>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const supabase = createClient();
                      const url = await getBookingFileUrl(supabase, "booking-documents", document.storagePath);
                      window.open(url, "_blank", "noopener,noreferrer");
                    } catch {
                      showToast("This document could not be opened.", "error");
                    }
                  }}
                >
                  {formatDocumentType(document.documentType)} ({document.reviewStatus})
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <h3>Notifications</h3>
        <NotificationList uid={user.id} />
      </section>

      {agreement && customerSignature ? (
        <p className={styles.footnote}>
          Signed by {customerSignature.signerName} on{" "}
          {new Date(customerSignature.signedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}
