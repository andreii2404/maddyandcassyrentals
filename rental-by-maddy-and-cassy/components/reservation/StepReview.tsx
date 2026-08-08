"use client";

import type { Product } from "@/types/product";
import type { ReservationDraft } from "@/src/types/reservationDraft";
import { formatCustomerAddress, formatCustomerLocation, getDayCount } from "@/src/types/reservationDraft";

import BookingSummaryCard from "@/components/booking-summary/BookingSummaryCard";

import formStyles from "@/components/ui/Form.module.css";
import styles from "./StepShared.module.css";
import reviewStyles from "./StepReview.module.css";

interface StepReviewProps {
  product: Product;
  draft: ReservationDraft;
  onEditStep: (step: number) => void;
  onBack: () => void;
  onSubmit: () => void | Promise<void>;
  submitting: boolean;
  submitError: string | null;
}

export default function StepReview({
  product,
  draft,
  onEditStep,
  onBack,
  onSubmit,
  submitting,
  submitError,
}: StepReviewProps) {
  const dayCount = getDayCount(
    draft.startDate,
    draft.endDate,
  );

  const handleSubmit = () => {
    if (submitting) {
      return;
    }

    void onSubmit();
  };

  return (
    <div
      className={styles.wrapper}
      aria-busy={submitting}
    >
      <h2 className={styles.heading}>
        Review &amp; Submit
      </h2>

      <p className={styles.subheading}>
        Please review your booking request. You can edit any
        section before submitting.
      </p>

      <section className={reviewStyles.section}>
        <div className={reviewStyles.sectionHeader}>
          <h3>Rental Details</h3>

          <button
            type="button"
            className={reviewStyles.editLink}
            onClick={() => onEditStep(1)}
            disabled={submitting}
          >
            Edit
          </button>
        </div>

        {draft.startDate &&
        draft.endDate &&
        draft.fulfillmentMethod ? (
          <BookingSummaryCard
            productName={product.name}
            brand={product.brand ?? ""}
            productImage={product.image}
            pricePerDay={product.pricePerDay}
            currency={product.currency}
            startDate={draft.startDate}
            endDate={draft.endDate}
            dayCount={dayCount}
            quantity={draft.quantity}
            fulfillmentMethod={draft.fulfillmentMethod}
            customerLocation={formatCustomerLocation(draft)}
          />
        ) : (
          <p className={formStyles.errorText}>
            Rental details are incomplete.
          </p>
        )}
      </section>

      <section className={reviewStyles.section}>
        <div className={reviewStyles.sectionHeader}>
          <h3>Customer Information</h3>

          <button
            type="button"
            className={reviewStyles.editLink}
            onClick={() => onEditStep(2)}
            disabled={submitting}
          >
            Edit
          </button>
        </div>

        <dl className={reviewStyles.detailGrid}>
          <div>
            <dt>Full Name</dt>
            <dd>
              {draft.customerInfo.fullName || "Not provided"}
            </dd>
          </div>

          <div>
            <dt>Email</dt>
            <dd>
              {draft.customerInfo.email || "Not provided"}
            </dd>
          </div>

          <div>
            <dt>Phone</dt>
            <dd>
              {draft.customerInfo.phone || "Not provided"}
            </dd>
          </div>

          <div>
            <dt>Address</dt>
            <dd>
              {formatCustomerAddress(draft.customerInfo) || "Not provided"}
            </dd>
          </div>
        </dl>
      </section>

      <section className={reviewStyles.section}>
        <div className={reviewStyles.sectionHeader}>
          <h3>Rental Requirements</h3>

          <button
            type="button"
            className={reviewStyles.editLink}
            onClick={() => onEditStep(3)}
            disabled={submitting}
          >
            Edit
          </button>
        </div>

        <dl className={reviewStyles.detailGrid}>
          <div>
            <dt>First ID</dt>
            <dd>
              {draft.requirements.idOneFile?.name ??
                "Not uploaded"}
            </dd>
          </div>

          <div>
            <dt>Second ID</dt>
            <dd>
              {draft.requirements.idTwoFile?.name ??
                "Not uploaded"}
            </dd>
          </div>

          <div>
            <dt>Selfie with ID</dt>
            <dd>
              {draft.requirements.selfieFile?.name ??
                "Not uploaded"}
            </dd>
          </div>

          <div>
            <dt>Emergency Contact</dt>
            <dd>
              {draft.requirements.emergencyContact.fullName
                ? `${draft.requirements.emergencyContact.fullName}${
                    draft.requirements.emergencyContact
                      .relationship
                      ? ` (${draft.requirements.emergencyContact.relationship})`
                      : ""
                  }`
                : "Not provided"}
            </dd>
          </div>
        </dl>
      </section>

      <section className={reviewStyles.section}>
        <div className={reviewStyles.sectionHeader}>
          <h3>Agreement &amp; Signature</h3>

          <button
            type="button"
            className={reviewStyles.editLink}
            onClick={() => onEditStep(4)}
            disabled={submitting}
          >
            Edit
          </button>
        </div>

        <div className={reviewStyles.signaturePreviewRow}>
          {draft.agreement.signatureDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.agreement.signatureDataUrl}
              alt="Customer signature"
              className={reviewStyles.signatureImage}
            />
          ) : null}

          <div>
            <p className={reviewStyles.signedBy}>
              {draft.agreement.typedFullName ||
                "No signature provided"}
            </p>

            <p className={reviewStyles.termsAccepted}>
              All terms, conditions, and the privacy notice
              have been accepted.
            </p>
          </div>
        </div>
      </section>

      {submitError ? (
        <p
          className={formStyles.errorText}
          role="alert"
          aria-live="assertive"
        >
          {submitError}
        </p>
      ) : null}

      <div className={styles.confirmCallout}>
        Are you sure you want to save these details and submit this booking
        request for review?
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={formStyles.secondaryButton}
          onClick={onBack}
          disabled={submitting}
        >
          Back
        </button>

        <button
          type="button"
          className={formStyles.primaryButton}
          onClick={handleSubmit}
          disabled={
            submitting ||
            !draft.startDate ||
            !draft.endDate ||
            !draft.fulfillmentMethod
          }
        >
          {submitting
            ? "Submitting Booking Request..."
            : "Confirm & Submit Booking"}
        </button>
      </div>
    </div>
  );
}
