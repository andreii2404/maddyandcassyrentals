"use client";

import { Button } from "@/components/ui/Button";
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { UserNotification } from "@/src/types/notification";
import { markNotificationRead, subscribeToUserNotifications } from "@/src/services/notificationService";
import { createClient } from "@/src/lib/supabase/client";
import styles from "./NotificationList.module.css";

export default function NotificationList({ uid }: { uid: string }) {
  const [notifications, setNotifications] = useState<UserNotification[]>([]);

  useEffect(() => {
    const supabase = createClient();
    return subscribeToUserNotifications(supabase, uid, setNotifications);
  }, [uid]);

  if (notifications.length === 0) {
    return <p className={styles.empty}>You have no notifications yet.</p>;
  }

  return (
    <ul className={styles.list}>
      {notifications.map((notification) => (
        <li
          key={notification.id}
          className={`${styles.item} ${notification.isRead ? "" : styles.unread}`}
        >
          <div>
            <p className={styles.title}>{notification.title}</p>
            <p className={styles.message}>{notification.message}</p>
            <p className={styles.time}>
              {notification.createdAt
                ? formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })
                : ""}
            </p>
          </div>
          {!notification.isRead ? (
            <Button variant="none"
              type="button"
              className={styles.markReadButton}
              onClick={() => markNotificationRead(createClient(), notification.id)}
            >
              Mark as read
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
