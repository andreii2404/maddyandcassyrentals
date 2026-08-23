"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/src/lib/supabase/client";
import { getBookingsForUser } from "@/src/services/bookingService";
import type { Booking } from "@/src/types/booking";
import { bookingHeadline, bookingTotalDailyRate, bookingTotalQuantity } from "@/src/lib/bookingDisplay";
import { getBookingStatusMessage, getFulfillmentProgressLabel } from "@/src/lib/bookingManagement";
import { getBookingLiveStatusLabel, useBookingRealtime } from "@/hooks/useBookingRealtime";
import BookingSummaryCard from "@/components/booking-summary/BookingSummaryCard";
import StatusBadge from "@/components/status-badge/StatusBadge";
import Spinner from "@/components/ui/Spinner";
import styles from "./guestBookings.module.css";

export default function GuestBookingsPage() {
  const { user, loading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const loadBookings = useCallback(async () => {
    if (!user?.is_anonymous) return;
    try {
      const records = await getBookingsForUser(createClient(), user.id);
      setBookings(records.filter((booking) => booking.isGuestCheckout));
      setLoadError(false);
    } catch {
      setBookings([]);
      setLoadError(true);
    }
  }, [user]);

  useEffect(() => {
    if (!user?.is_anonymous) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBookings();
  }, [loadBookings, user]);

  const liveStatus = useBookingRealtime({
    customerId: user?.is_anonymous ? user.id : undefined,
    enabled: Boolean(user?.is_anonymous),
    onChange: loadBookings,
  });

  if (authLoading) {
    return <div className={styles.loading}><Spinner label="Loading guest bookings" /></div>;
  }

  if (!user?.is_anonymous) {
    return (
      <section className={styles.sessionCard}>
        <span className={styles.sessionIcon} aria-hidden="true">G</span>
        <div>
          <p className={styles.eyebrow}>GUEST BOOKING ACCESS</p>
          <h1>No guest checkout is saved in this browser.</h1>
          <p>
            Guest bookings are protected by the temporary session created during checkout. Open
            this page on the same browser and device used to book, without clearing site data.
          </p>
          <p>
            If that session is no longer available, contact the team with your booking reference
            and checkout email so your identity can be verified.
          </p>
          <div className={styles.sessionActions}>
            <Link href="/catalog">Browse Rentals</Link>
            <Link href="/contact">Contact Support</Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>SAME-BROWSER GUEST TRACKING</p>
          <h1>Guest Bookings</h1>
          <p>Review every reservation made during this guest session and open its live tracker.</p>
        </div>
        <div className={styles.headerActions}>
          <span className={`${styles.liveStatus} ${styles[liveStatus]}`}>
            <span aria-hidden="true" />{getBookingLiveStatusLabel(liveStatus)}
          </span>
          <Link href="/catalog">Book another rental</Link>
        </div>
      </header>

      <aside className={styles.accessNote}>
        <strong>Keep access until your rental is complete.</strong>
        <span>
          Use this same browser and device and do not clear this site&apos;s data. Save each booking
          reference as a backup. An optional customer account provides cross-session history and
          birthday and loyalty perks; guest bookings do not earn those perks.
        </span>
      </aside>

      <section className={styles.panel} aria-labelledby="guest-bookings-heading">
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>YOUR RESERVATIONS</p>
            <h2 id="guest-bookings-heading">{bookings?.length ?? 0} saved in this session</h2>
          </div>
          <Link href="/sign-up">Create an optional account</Link>
        </div>

        {bookings === null ? (
          <div className={styles.loading}><Spinner label="Loading guest bookings" /></div>
        ) : loadError ? (
          <div className={styles.empty}>
            <strong>Guest bookings could not be loaded.</strong>
            <p>Please refresh this page and try again.</p>
          </div>
        ) : bookings.length === 0 ? (
          <div className={styles.empty}>
            <strong>No completed guest checkout yet.</strong>
            <p>After the final booking step, the reservation and its tracking status will appear here.</p>
            <Link href="/catalog">Browse Rentals</Link>
          </div>
        ) : (
          <ul className={styles.list} aria-live="polite">
            {bookings.map((booking) => (
              <li key={booking.id}>
                <Link href={`/guest/bookings/${booking.id}`} className={styles.bookingLink}>
                  <BookingSummaryCard
                    bookingRef={booking.bookingRef}
                    productName={bookingHeadline(booking.items)}
                    brand={booking.items.length === 1 ? booking.productSnapshot.brand : ""}
                    productImage={booking.productSnapshot.image}
                    pricePerDay={bookingTotalDailyRate(booking.items)}
                    currency={booking.productSnapshot.currency}
                    startDate={new Date(booking.startDate)}
                    endDate={new Date(booking.endDate)}
                    dayCount={booking.dayCount}
                    quantity={bookingTotalQuantity(booking.items)}
                    fulfillmentMethod={booking.fulfillmentMethod}
                    customerLocation={booking.fulfillmentMethod === "pickup"
                      ? "Business pickup point"
                      : [booking.location, booking.cityMunicipality, booking.province].filter(Boolean).join(", ")}
                    statusSlot={<StatusBadge status={booking.status} />}
                  />
                  <div className={styles.bookingFooter}>
                    <div>
                      <strong>{getFulfillmentProgressLabel(booking.status, booking.fulfillmentMethod)}</strong>
                      <span>{getBookingStatusMessage(booking.status, booking.fulfillmentMethod)}</span>
                    </div>
                    <b>Open tracker <span aria-hidden="true">→</span></b>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
