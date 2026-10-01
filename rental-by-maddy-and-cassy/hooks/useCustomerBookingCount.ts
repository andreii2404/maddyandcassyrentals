"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/src/lib/supabase/client";
import { countBookingsForUser } from "@/src/services/bookingService";

/**
 * Live total of the signed-in customer's bookings for the account menu badge.
 * Re-counts on any change to that customer's booking rows (create, cancel,
 * complete, delete), on tab focus, on `refreshKey` changes, and on a quiet
 * 60s fallback. Kept separate from useBookingRealtime so the navbar does not
 * fire its global "booking-live-update" event on every page.
 */
export function useCustomerBookingCount(customerId: string | null, refreshKey?: string): number | null {
  const [result, setResult] = useState<{ ownerId: string; count: number } | null>(null);

  useEffect(() => {
    if (!customerId) return undefined;
    const ownerId = customerId;
    const supabase = createClient();
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadCount() {
      try {
        const count = await countBookingsForUser(supabase, ownerId);
        if (active) setResult({ ownerId, count });
      } catch {
        // Keep the last known count; the next change, focus, or interval retries.
      }
    }

    const refresh = () => {
      if (!active) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void loadCount(), 180);
    };

    void loadCount();

    const channel = supabase
      .channel(`booking-count-${ownerId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings", filter: `customer_id=eq.${ownerId}` },
        refresh,
      )
      .subscribe();

    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const fallbackInterval = window.setInterval(refresh, 60_000);
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
  }, [customerId, refreshKey]);

  // Never surface a count that belongs to a previous session's user.
  return customerId && result?.ownerId === customerId ? result.count : null;
}
