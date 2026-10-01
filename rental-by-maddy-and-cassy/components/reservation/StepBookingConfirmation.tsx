import { Button } from "@/components/ui/Button";
import styles from "./StepBookingConfirmation.module.css";
import { bookingTrackingPath } from "@/src/lib/bookingAccess";

const NEXT_STEPS = [
  { label: "Submitted", note: "Payment, documents, and signed agreement received" },
  { label: "Document verification", note: "Our team is reviewing your submission" },
  { label: "Approval", note: "The team approves your booking" },
  { label: "Confirmed", note: "Your rental is officially reserved" },
];

/** Index of the stage the booking is in right after submission. */
const CURRENT_STAGE = 1;

export default function StepBookingConfirmation({
  bookingId,
  bookingNumber,
  isDemo = false,
  isGuest = false,
}: {
  bookingId: string;
  bookingNumber: string;
  isDemo?: boolean;
  isGuest?: boolean;
}) {
  return (
    <div className={styles.wrapper}>
      <section className={styles.hero} aria-labelledby="booking-confirmation-heading">
        <span className={styles.icon} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <div className={styles.heroText}>
          <span className={styles.statusBadge}>
            <span className={styles.statusDot} aria-hidden="true" />
            Pending Verification
          </span>
          <h2 id="booking-confirmation-heading">Booking request submitted</h2>
          <p className={styles.reference}>
            Booking reference <strong>{bookingNumber}</strong>
          </p>
          <p className={styles.explanation}>
            Your booking is <strong>not yet confirmed</strong>. It is now awaiting document
            verification by our team. Once approved, its status will change to Confirmed.
          </p>
          {isDemo ? (
            <p className={styles.demoNote}>Demo flow completed. No real payment was processed.</p>
          ) : null}
        </div>
      </section>

      <section className={styles.nextSteps} aria-labelledby="booking-next-steps-heading">
        <h3 id="booking-next-steps-heading">What happens next</h3>
        <ol className={styles.timeline}>
          {NEXT_STEPS.map((stage, index) => {
            const state = index < CURRENT_STAGE ? "done" : index === CURRENT_STAGE ? "current" : "upcoming";
            return (
              <li
                key={stage.label}
                className={`${styles.stage} ${styles[state]}`}
                aria-current={state === "current" ? "step" : undefined}
              >
                <span className={styles.stageMarker} aria-hidden="true">
                  {state === "done" ? "✓" : index + 1}
                </span>
                <span className={styles.stageText}>
                  <strong>{stage.label}</strong>
                  <small>{stage.note}</small>
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <p className={styles.documentsNote}>
        Your {isDemo ? "demo-labeled" : "GCash payment"} receipt, proof of payment, and booking
        invoice are available in your {isGuest ? "guest booking" : "account"}.
      </p>

      {isGuest ? (
        <div className={styles.guestNote}>
          <strong>No account is required to finish this booking.</strong>
          <p>
            Track payment, document review, agreement, confirmation, and fulfillment from
            <b> Guest Bookings</b> in the website header. Keep reference <b>{bookingNumber}</b>, and
            use this same browser and device without clearing site data until the rental is complete.
          </p>
          <small>
            Customer accounts are optional. Create one for future rentals to receive the
            birthday-month discount and 11th-rental loyalty reward; guest bookings do not earn
            those account perks.
          </small>
        </div>
      ) : null}

      <div className={styles.actions}>
        <Button
          href={`${bookingTrackingPath(bookingId, isGuest)}?justSubmitted=1`}
          variant="primary"
          size="lg"
          className={styles.primaryAction}
        >
          {isGuest ? "Track Guest Booking" : "View Booking & Documents"}
        </Button>
        <Button
          href={isGuest ? "/guest/bookings" : "/account/payments"}
          variant="secondary"
          size="lg"
        >
          {isGuest ? "All Guest Bookings" : "Payment History"}
        </Button>
        {isGuest ? null : (
          <Button href="/account/bookings" variant="tertiary" className={styles.backLink}>
            ← Back to My Bookings
          </Button>
        )}
      </div>
    </div>
  );
}
