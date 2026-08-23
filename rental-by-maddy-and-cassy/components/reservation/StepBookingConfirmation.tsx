import Link from "next/link";
import formStyles from "@/components/ui/Form.module.css";
import sharedStyles from "./StepShared.module.css";
import styles from "./StepPaymentSubmission.module.css";
import { bookingTrackingPath } from "@/src/lib/bookingAccess";

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
    <div className={sharedStyles.wrapper}>
      <h2 className={sharedStyles.heading}>Booking Confirmation</h2>
      <div className={styles.success}>
        {isDemo
          ? "Demo flow completed. No real payment was processed."
          : "Your reservation is secured and your booking information has been submitted successfully."}
      </div>
      <p className={sharedStyles.subheading}>
        Booking {bookingNumber} is now with the team for document verification. Once approved,
        its status will change to Confirmed. Your {isDemo ? "demo-labeled" : "GCash payment"} receipt,
        proof of payment, and booking invoice are available in your account.
      </p>
      {isGuest ? (
        <div className={styles.guestConfirmation}>
          <strong>No account is required to finish this booking.</strong>
          <p>
            Track payment, document review, agreement, confirmation, and fulfillment from this
            browser. Keep reference <b>{bookingNumber}</b>, and do not clear this site&apos;s browser
            data until the rental is complete.
          </p>
          <small>
            Customer accounts are optional. Create one for future rentals to receive the
            birthday-month discount and 11th-rental loyalty reward; guest bookings do not earn
            those account perks.
          </small>
        </div>
      ) : null}
      <div className={sharedStyles.footer}>
        <Link href={isGuest ? "/catalog" : "/account/payments"} className={formStyles.secondaryButton}>
          {isGuest ? "Browse Rentals" : "Payment History"}
        </Link>
        <Link
          href={`${bookingTrackingPath(bookingId, isGuest)}?justSubmitted=1`}
          className={formStyles.primaryButton}
        >
          {isGuest ? "Track Guest Booking" : "View Booking & Documents"}
        </Link>
      </div>
    </div>
  );
}
