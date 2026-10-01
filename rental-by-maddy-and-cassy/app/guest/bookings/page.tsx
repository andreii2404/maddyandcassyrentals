"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/src/lib/supabase/client";
import { getBookingsForUser } from "@/src/services/bookingService";
import type { Booking } from "@/src/types/booking";
import { bookingHeadline, bookingTotalDailyRate, bookingTotalQuantity } from "@/src/lib/bookingDisplay";
import { getBookingStatusMessage, getFulfillmentProgressLabel } from "@/src/lib/bookingManagement";
import { formatManilaDateTime } from "@/src/lib/rentalTiming";
import { useBookingRealtime } from "@/hooks/useBookingRealtime";
import StatusBadge from "@/components/status-badge/StatusBadge";
import Spinner from "@/components/ui/Spinner";
import GuestBookingRecoveryForm from "@/components/guest-booking/GuestBookingRecoveryForm";
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

  useBookingRealtime({
    customerId: user?.is_anonymous ? user.id : undefined,
    enabled: Boolean(user?.is_anonymous),
    onChange: loadBookings,
  });

  if (authLoading) {
    return <div className={styles.loading}><Spinner label="Loading guest bookings" /></div>;
  }

  if (!user) {
    return (
      <div className={styles.wrapper}>
        <GuestBookingRecoveryForm />
      </div>
    );
  }

  if (!user.is_anonymous) {
    return (
      <section className={styles.sessionCard}>
        <span className={styles.sessionIcon} aria-hidden="true">✓</span>
        <div>
          <p className={styles.eyebrow}>CUSTOMER ACCOUNT ACTIVE</p>
          <h1>You&apos;re currently signed in.</h1>
          <p>
            Rentals made with this account are already saved in My Bookings. To recover a separate
            guest checkout, sign out first and return to Track Guest Booking.
          </p>
          <div className={styles.sessionActions}>
            <Link href="/account/bookings">Open My Bookings</Link>
            <Link href="/catalog">Browse Rentals</Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>GUEST BOOKING TRACKING</p>
          <h1>Guest Bookings</h1>
          <p>Review every reservation made during this guest session and open its live tracker.</p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/catalog" className={styles.secondaryAction}>Book another rental</Link>
        </div>
      </header>

      <aside className={styles.accessNote}>
        <span className={styles.accessIcon} aria-hidden="true">i</span>
        <p>
          <strong>Keep access until your rental is complete.</strong>{" "}
          Save your booking reference, checkout email, and mobile number. If this browser loses the
          guest session, Track Guest Booking restores access. An optional account adds automatic
          history plus birthday and loyalty perks, which guest bookings don&apos;t earn.
        </p>
      </aside>

      <section className={styles.panel} aria-labelledby="guest-bookings-heading">
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>YOUR RESERVATIONS</p>
            <h2 id="guest-bookings-heading">{bookings?.length ?? 0} saved in this session</h2>
          </div>
          <Link href="/sign-up" className={styles.accountLink}>Create an optional account</Link>
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
            {bookings.map((booking) => {
              const productName = bookingHeadline(booking.items);
              const brand = booking.items.length === 1 ? booking.productSnapshot.brand : "";
              const productImage = booking.productSnapshot.image.trim() || "/images/product-placeholder.png";
              const quantity = bookingTotalQuantity(booking.items);
              const location = booking.fulfillmentMethod === "pickup"
                ? "Business pickup point"
                : [booking.location, booking.cityMunicipality, booking.province].filter(Boolean).join(", ");

              return (
                <li key={booking.id}>
                  <Link href={`/guest/bookings/${booking.id}`} className={styles.bookingLink}>
                    <div className={styles.bookingTop}>
                      <div className={styles.bookingImage}>
                        <Image src={productImage} alt={productName} fill sizes="56px" />
                      </div>
                      <div className={styles.bookingIdentity}>
                        <p className={styles.bookingRef}>{booking.bookingRef}</p>
                        <h3>{productName}</h3>
                        {brand ? <p className={styles.bookingBrand}>{brand}</p> : null}
                      </div>
                      <span className={styles.bookingStatus}>
                        <StatusBadge status={booking.status} />
                      </span>
                    </div>

                    <dl className={styles.bookingDetails}>
                      <div className={styles.detailSection}>
                        <dt>Rental schedule</dt>
                        <dd>
                          <span className={styles.detailRow}>
                            <em>Pickup</em>
                            {formatManilaDateTime(new Date(booking.startDate))}
                          </span>
                          <span className={styles.detailRow}>
                            <em>Return</em>
                            {formatManilaDateTime(new Date(booking.endDate))}
                          </span>
                          <span className={styles.detailMuted}>
                            {booking.dayCount === 1 ? "22 hours" : `${booking.dayCount} days`}
                          </span>
                        </dd>
                      </div>
                      <div className={styles.detailSection}>
                        <dt>Fulfillment</dt>
                        <dd>
                          <span>{booking.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"}</span>
                          <span className={styles.detailMuted}>
                            {getFulfillmentProgressLabel(booking.status, booking.fulfillmentMethod)}
                          </span>
                        </dd>
                      </div>
                      <div className={styles.detailSection}>
                        <dt>Quantity &amp; rate</dt>
                        <dd>
                          <span>{quantity} {quantity === 1 ? "unit" : "units"}</span>
                          <span className={styles.detailMuted}>
                            {booking.productSnapshot.currency}
                            {bookingTotalDailyRate(booking.items).toLocaleString()} / day
                          </span>
                        </dd>
                      </div>
                      <div className={styles.detailSection}>
                        <dt>Location</dt>
                        <dd><span>{location}</span></dd>
                      </div>
                    </dl>

                    <div className={styles.bookingFooter}>
                      <p>{getBookingStatusMessage(booking.status, booking.fulfillmentMethod)}</p>
                      <span className={styles.trackerButton}>Open tracker</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {bookings !== null && bookings.length === 0 ? (
        <GuestBookingRecoveryForm hasGuestSession />
      ) : null}
    </div>
  );
}
