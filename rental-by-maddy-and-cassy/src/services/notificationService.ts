import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/src/lib/supabase/database.types";
import type { UserNotification } from "@/src/types/notification";

function mapNotification(row: Tables<"notifications">): UserNotification {
  return {
    id: row.id,
    userId: row.user_id,
    bookingId: row.booking_id ?? undefined,
    type: row.notification_type,
    title: row.title,
    message: row.message,
    actionUrl: row.action_url ?? undefined,
    isRead: row.is_read,
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
  };
}

/**
 * Loads existing notifications, listens for Realtime events when available,
 * and uses booking events plus a quiet polling/focus fallback to stay fresh.
 */
export function subscribeToUserNotifications(
  supabase: SupabaseClient<Database>,
  uid: string,
  callback: (notifications: UserNotification[]) => void,
): () => void {
  let current: UserNotification[] = [];

  const loadNotifications = async () => {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });
    if (data) {
      current = data.map(mapNotification);
      callback(current);
    }
  };

  void loadNotifications();

  const channel = supabase
    .channel(`notifications-${uid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
      (payload) => {
        if (payload.eventType === "INSERT") {
          current = [mapNotification(payload.new as Tables<"notifications">), ...current];
        } else if (payload.eventType === "UPDATE") {
          const updated = mapNotification(payload.new as Tables<"notifications">);
          current = current.map((item) => (item.id === updated.id ? updated : item));
        } else if (payload.eventType === "DELETE") {
          const oldRow = payload.old as Tables<"notifications">;
          current = current.filter((item) => item.id !== oldRow.id);
        }
        callback(current);
      },
    )
    .subscribe();

  const refreshNotifications = () => void loadNotifications();
  const fallbackInterval = window.setInterval(refreshNotifications, 30_000);
  window.addEventListener("booking-live-update", refreshNotifications);
  window.addEventListener("focus", refreshNotifications);

  return () => {
    window.clearInterval(fallbackInterval);
    window.removeEventListener("booking-live-update", refreshNotifications);
    window.removeEventListener("focus", refreshNotifications);
    supabase.removeChannel(channel);
  };
}

export async function markNotificationRead(
  supabase: SupabaseClient<Database>,
  notificationId: string,
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", notificationId);
  if (error) throw new Error(error.message);
}
