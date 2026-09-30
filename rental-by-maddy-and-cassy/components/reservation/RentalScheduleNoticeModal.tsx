"use client";

import { useRouter } from "next/navigation";
import Modal from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { FulfillmentMethod } from "@/src/types/booking";
import {
  DELIVERY_TRANSPORT_ALLOWANCE_HOURS,
  calculateEstimatedDeliveryDateTime,
  formatManilaDateTime,
} from "@/src/lib/rentalTiming";
import styles from "./RentalScheduleNoticeModal.module.css";

// Reuses the same Facebook page already listed as the official contact
// channel on /contact -- do not swap in a Messenger deep link that isn't
// configured elsewhere in the app.
const MESSENGER_URL = "https://www.facebook.com/share/19bCnTQZum/";

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
  const router = useRouter();
  const isDelivery = fulfillmentMethod === "delivery";

  return (
    <Modal
      title="Rental Schedule Reminder"
      onClose={onGoBack}
      describedBy="rental-schedule-notice-description"
    >
      <div className={styles.body}>
        <p id="rental-schedule-notice-description" className={styles.leadText}>
          Your selected date and time is your preferred rental schedule.
        </p>

        <dl className={styles.schedule} aria-label="Your rental schedule">
          <div className={styles.scheduleRow}>
            <dt>Selected schedule ({isDelivery ? "delivery" : "pickup"})</dt>
            <dd>{formatManilaDateTime(pickupAt)}</dd>
          </div>
          {isDelivery ? (
            <div className={styles.scheduleRow}>
              <dt>Estimated delivery time</dt>
              <dd>
                {formatManilaDateTime(calculateEstimatedDeliveryDateTime(pickupAt))} or later
                <span className={styles.scheduleNote}>
                  Includes the {DELIVERY_TRANSPORT_ALLOWANCE_HOURS}-hour minimum transportation allowance
                </span>
              </dd>
            </div>
          ) : null}
          <div className={styles.scheduleRow}>
            <dt>Return schedule</dt>
            <dd>{formatManilaDateTime(returnAt)}</dd>
          </div>
        </dl>

        <p className={styles.text}>
          Please allow additional time for preparation and transportation. The actual time may be
          shorter or longer depending on your location, distance, traffic, weather, and other
          travel conditions.
        </p>

        <p className={styles.highlight}>
          For delivery, allow at least <strong>2 additional hours as a minimum transportation
          allowance</strong>, but actual delivery may take longer depending on the location.
        </p>

        <p className={styles.text}>
          For pickup, travel time will depend on how far you are from the pickup location.
        </p>

        <p className={styles.text}>
          If you need an update about the schedule, item preparation, pickup, or delivery status,
          you can contact us through Chat or Messenger.
        </p>

        <div className={styles.contactRow}>
          <span className={styles.contactLabel}>Need to reach us first?</span>
          <div className={styles.contactActions}>
            <Button
              variant="tertiary"
              size="sm"
              type="button"
              onClick={() => router.push("/messages")}
            >
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
