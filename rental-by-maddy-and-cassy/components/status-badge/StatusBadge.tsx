import type { BookingStatus } from "@/src/types/booking";
import styles from "./StatusBadge.module.css";

export type StatusTone = "green" | "yellow" | "red" | "neutral";

const STATUS_LABELS: Record<BookingStatus, string> = {
  draft: "Draft",
  pending: "Pending Review",
  approved: "Approved",
  confirmed: "Confirmed",
  ready_for_release: "Ready for Release",
  released: "Released to Customer",
  returned: "Returned / Completed",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

const STATUS_TONE: Record<BookingStatus, StatusTone> = {
  draft: "neutral",
  pending: "yellow",
  approved: "green",
  confirmed: "green",
  ready_for_release: "green",
  released: "green",
  returned: "neutral",
  cancelled: "red",
  rejected: "red",
};

interface StatusBadgeProps {
  status?: BookingStatus;
  /**
   * Custom label for non-booking statuses (account status, payment status).
   * Pair with `tone` when the status is not a BookingStatus.
   */
  label?: string;
  tone?: StatusTone;
}

export default function StatusBadge({ status, label, tone }: StatusBadgeProps) {
  const resolvedLabel = label ?? (status ? STATUS_LABELS[status] : undefined);
  const resolvedTone = tone ?? (status ? STATUS_TONE[status] : "neutral");
  if (!resolvedLabel) return null;

  return (
    <span className={`${styles.badge} ${styles[resolvedTone]}`}>
      {resolvedLabel}
    </span>
  );
}
