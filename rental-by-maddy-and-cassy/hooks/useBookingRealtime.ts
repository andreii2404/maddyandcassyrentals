"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/src/lib/supabase/client";

export type BookingLiveStatus = "connecting" | "live" | "reconnecting";

interface UseBookingRealtimeOptions {
  bookingId?: string;
  customerId?: string;
  /**
   * When set, subscribes to every listed table (all events, unfiltered) instead of the
   * default single `bookings` row/table subscription below. Used by admin-wide views that
   * need to react to more than one table (e.g. payments, which spans bookings and
   * booking_payment_submissions).
   */
  tables?: string[];
  enabled?: boolean;
  onChange: () => void | Promise<void>;
}

/**
 * Keeps admin/booking views synchronized through Supabase Postgres Changes. A quiet
 * polling/focus fallback covers sleeping tabs and temporary WebSocket outages.
 */
export function useBookingRealtime({
  bookingId,
  customerId,
  tables,
  enabled = true,
  onChange,
}: UseBookingRealtimeOptions): BookingLiveStatus {
  const [status, setStatus] = useState<BookingLiveStatus>("connecting");
  const onChangeRef = useRef(onChange);
  // Callers typically pass a fresh `tables` array literal each render; keying the
  // subscription effect off this joined string (rather than the array itself) avoids
  // tearing down and reopening the channel every render.
  const tablesKey = tables?.join(",");

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

    const suffix = bookingId ?? customerId ?? tables?.join("-") ?? "admin";
    let channel = supabase.channel(`booking-live-${suffix}-${Math.random().toString(36).slice(2)}`);

    if (tables?.length) {
      for (const table of tables) {
        channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
      }
    } else if (bookingId) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings", filter: `id=eq.${bookingId}` },
        refresh,
      );
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "booking_payment_submissions",
          filter: `booking_id=eq.${bookingId}`,
        },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tablesKey is the stable proxy for `tables`
  }, [bookingId, customerId, tablesKey, enabled]);

  return status;
}
