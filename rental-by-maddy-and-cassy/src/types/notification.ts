export type NotificationType =
  | "booking_status_changed"
  | "booking_confirmed"
  | "booking_cancelled"
  | "booking_cancellation_requested"
  | "booking_cancellation_decision"
  | "agreement_ready"
  | "requirements_reviewed"
  | "payment_pending"
  | "payment_paid"
  | "document_ready";

/** public.notifications */
export interface UserNotification {
  id: string;
  userId: string;
  bookingId?: string;
  type: NotificationType | string;
  title: string;
  message: string;
  actionUrl?: string;
  isRead: boolean;
  createdAt: string;
  readAt?: string;
  expiresAt?: string;
}
