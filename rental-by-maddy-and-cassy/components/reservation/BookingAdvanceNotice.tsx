import { SAME_DAY_CONVENIENCE_FEE } from "@/src/lib/rentalTiming";
import styles from "./BookingAdvanceNotice.module.css";

interface BookingAdvanceNoticeProps {
  /** True when the selected rental date is today, so the fee is currently in the total. */
  applied: boolean;
}

/** Compact "Booking in Advance" notice shown above the date and time selection. */
export default function BookingAdvanceNotice({ applied }: BookingAdvanceNoticeProps) {
  return (
    <aside className={styles.notice} data-applied={applied} aria-label="Booking in advance">
      <span className={styles.icon} aria-hidden="true">i</span>
      <div className={styles.body}>
        <h3 className={styles.title}>Booking in Advance</h3>
        <p className={styles.text}>
          To secure any rental, reservations must be made ahead of time. Same-day bookings may be
          accepted only if available and once all necessary requirements are fulfilled.
        </p>
        <p className={styles.fee}>
          <strong>+ ₱{SAME_DAY_CONVENIENCE_FEE} convenience fee for same-day rental.</strong>
          {applied ? (
            <span className={styles.applied} role="status">
              Applied to your total
            </span>
          ) : null}
        </p>
      </div>
    </aside>
  );
}
