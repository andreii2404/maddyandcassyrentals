"use client";

import Modal from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { FulfillmentMethod } from "@/src/types/booking";
import {
  DELIVERY_TRANSPORT_ALLOWANCE_HOURS,
  calculateEstimatedDeliveryDateTime,
  formatManilaDateTime,
  formatManilaPickupTime,
} from "@/src/lib/rentalTiming";
import styles from "./RentalScheduleNoticeModal.module.css";

// Reuses the same Facebook page already listed as the official contact
// channel on /contact -- do not swap in a Messenger deep link that isn't
// configured elsewhere in the app.
const MESSENGER_URL = "https://www.facebook.com/share/19bCnTQZum/";

function manilaDateKey(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(value);
}

interface RentalScheduleNoticeModalProps {
  /** Selected pickup/delivery handover timestamp (Manila) from the live draft. */
  pickupAt: Date;
  /** Return timestamp derived from pickupAt and the selected rental days. */
  returnAt: Date;
  fulfillmentMethod: FulfillmentMethod;
  onGoBack: () => void;
  onContinue: () => void;
}

export default function RentalScheduleNoticeModal({
  pickupAt,
  returnAt,
  fulfillmentMethod,
  onGoBack,
  onContinue,
}: RentalScheduleNoticeModalProps) {
  const isDelivery = fulfillmentMethod === "delivery";
  const estimatedArrivalAt = calculateEstimatedDeliveryDateTime(pickupAt);
  // Late-evening schedules can roll the estimate into the next day; show the
  // full date then so the arrival time is never ambiguous.
  const estimatedArrivalLabel =
    manilaDateKey(estimatedArrivalAt) === manilaDateKey(pickupAt)
      ? formatManilaPickupTime(estimatedArrivalAt)
      : formatManilaDateTime(estimatedArrivalAt);

  return (
    <Modal
      title="Rental Schedule Reminder"
      onClose={onGoBack}
      describedBy="rental-schedule-notice-description"
    >
      <div className={styles.body}>
        <p id="rental-schedule-notice-description" className={styles.leadText}>
          Please review your schedule before continuing.
        </p>

        <dl className={styles.schedule} aria-label="Your rental schedule">
          <div className={styles.scheduleRow}>
            <dt>{isDelivery ? "Delivery schedule" : "Pickup schedule"}</dt>
            <dd>{formatManilaDateTime(pickupAt)}</dd>
          </div>
          {isDelivery ? (
            <div className={`${styles.scheduleRow} ${styles.scheduleRowStacked}`}>
              <dt>Estimated arrival</dt>
              <dd>
                {formatManilaPickupTime(pickupAt)} + minimum {DELIVERY_TRANSPORT_ALLOWANCE_HOURS}-hour
                travel allowance = <strong>around {estimatedArrivalLabel}</strong> earliest
                estimated arrival
              </dd>
            </div>
          ) : null}
          <div className={styles.scheduleRow}>
            <dt>Return schedule</dt>
            <dd>{formatManilaDateTime(returnAt)}</dd>
          </div>
        </dl>

        {isDelivery ? (
          <p className={styles.note}>
            <strong>{estimatedArrivalLabel} is only the earliest estimate, not a guaranteed
            delivery time.</strong>{" "}
            Traffic, distance, weather, and courier availability may affect it.
          </p>
        ) : (
          <p className={styles.note}>
            Travel time depends on how far you are from the pickup location.
          </p>
        )}

        <div className={styles.contactRow}>
          <span className={styles.contactLabel}>Need a schedule update?</span>
          <div className={styles.contactActions}>
            <Button variant="tertiary" size="sm" href="/messages">
              Chat
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              href={MESSENGER_URL}
              target="_blank"
              rel="noreferrer"
            >
              Messenger
            </Button>
          </div>
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" type="button" onClick={onGoBack}>
            Go Back
          </Button>
          <Button variant="primary" type="button" onClick={onContinue}>
            I Understand, Continue
          </Button>
        </div>
      </div>
    </Modal>
  );
}
