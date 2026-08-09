"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/src/lib/supabase/client";

export type BookingLiveStatus = "connecting" | "live" | "reconnecting";

interface UseBookingRealtimeOptions {
  bookingId?: string;
  customerId?: string;
  enabled?: boolean;
  onChange: () => void | Promise<void>;
}

/**
 * Keeps booking views synchronized through Supabase Postgres Changes. A quiet
 * polling/focus fallback covers sleeping tabs and temporary WebSocket outages.
 */
export function useBookingRealtime({
  bookingId,
  customerId,
  enabled = true,
  onChange,
}: UseBookingRealtimeOptions): BookingLiveStatus {
  const [status, setStatus] = useState<BookingLiveStatus>("connecting");
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const refresh = () => {
      if (!active) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (active) {
          window.dispatchEvent(new CustomEvent("booking-live-update", { detail: { bookingId } }));
          void onChangeRef.current();
        }
      }, 180);
    };

    const suffix = bookingId ?? customerId ?? "admin";
    let channel = supabase.channel(`booking-live-${suffix}-${Math.random().toString(36).slice(2)}`);

    if (bookingId) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings", filter: `id=eq.${bookingId}` },
        refresh,
      );
    } else {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
          ...(customerId ? { filter: `customer_id=eq.${customerId}` } : {}),
        },
        refresh,
      );
    }

    channel.subscribe((subscriptionStatus) => {
      if (!active) return;
      if (subscriptionStatus === "SUBSCRIBED") {
        setStatus("live");
      } else if (
        subscriptionStatus === "CHANNEL_ERROR" ||
        subscriptionStatus === "TIMED_OUT" ||
        subscriptionStatus === "CLOSED"
      ) {
        setStatus("reconnecting");
      }
    });

    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const fallbackInterval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);

    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      window.clearInterval(fallbackInterval);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
      void supabase.removeChannel(channel);
    };
  }, [bookingId, customerId, enabled]);

  return status;
}

export function getBookingLiveStatusLabel(status: BookingLiveStatus): string {
  if (status === "live") return "Live updates connected";
  if (status === "reconnecting") return "Reconnecting - auto-refresh active";
  return "Connecting live updates";
}
