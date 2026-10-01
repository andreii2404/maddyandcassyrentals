"use client";

import { Button } from "@/components/ui/Button";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/src/lib/supabase/client";
import { getBookingsForUser } from "@/src/services/bookingService";
import type { Booking } from "@/src/types/booking";
import {
  bookingMatchesHistoryFilter,
  getBookingHistoryGroup,
  getBookingStatusMessage,
  getFulfillmentProgressLabel,
  type BookingHistoryFilter,
} from "@/src/lib/bookingManagement";
import { bookingHeadline, bookingTotalDailyRate, bookingTotalQuantity } from "@/src/lib/bookingDisplay";
import BookingSummaryCard from "@/components/booking-summary/BookingSummaryCard";
import BookingCancelAction from "@/components/booking-management/BookingCancelAction";
import StatusBadge from "@/components/status-badge/StatusBadge";
import Spinner from "@/components/ui/Spinner";
import { useBookingRealtime } from "@/hooks/useBookingRealtime";
import {
  COMPLETED_RENTALS_BEFORE_REWARD,
  LOYALTY_REWARD_RENTAL_NUMBER,
} from "@/src/lib/promotions";
import styles from "./bookings.module.css";

const FILTERS: Array<{ value: BookingHistoryFilter; label: string }> = [
  { value: "all", label: "All Bookings" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export default function BookingsListPage() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [filter, setFilter] = useState<BookingHistoryFilter>("all");
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState(false);

  const loadBookings = useCallback(async () => {
    if (!user) return;
    try {
      const records = await getBookingsForUser(createClient(), user.id);
      setBookings(records);
      setLoadError(false);
    } catch {
      setBookings([]);
      setLoadError(true);
    }
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBookings();
  }, [loadBookings]);

  useBookingRealtime({
    customerId: user?.id,
    enabled: Boolean(user),
    onChange: loadBookings,
  });

  const counts = useMemo(() => {
    const records = bookings ?? [];
    return {
      all: records.length,
      ongoing: records.filter((booking) => getBookingHistoryGroup(booking.status) === "ongoing").length,
      completed: records.filter((booking) => getBookingHistoryGroup(booking.status) === "completed").length,
      cancelled: records.filter((booking) => getBookingHistoryGroup(booking.status) === "cancelled").length,
    };
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (bookings ?? []).filter((booking) => {
      if (!bookingMatchesHistoryFilter(booking, filter)) return false;
      if (!query) return true;
      return [
        booking.bookingRef,
        ...booking.items.flatMap((item) => [item.productName, item.brand]),
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [bookings, filter, search]);

  const completedRentals = counts.completed;
  const loyaltyRewardBooking = bookings?.find(
    (booking) => booking.loyaltyDiscountAmount > 0 && booking.status !== "cancelled",
  );
  const progressPercent = Math.min(
    100,
    (completedRentals / COMPLETED_RENTALS_BEFORE_REWARD) * 100,
  );

  return (
    <div className={styles.wrapper}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Booking history</p>
          <h1>My Bookings</h1>
          <p className={styles.heroLead}>Track every request, payment milestone, handover update, and completed rental.</p>
        </div>
        <Link href="/catalog" className={styles.newBookingLink}>Book another rental</Link>
      </header>

      <section className={styles.summaryBar} aria-label="Booking summary">
        {FILTERS.map((item) => (
          <Button variant="none"
            key={item.value}
            type="button"
            className={`${styles.summaryItem} ${filter === item.value ? styles.summaryItemActive : ""}`}
            onClick={() => setFilter(item.value)}
            aria-pressed={filter === item.value}
          >
            <strong>{counts[item.value]}</strong>
            <span>{item.label}</span>
          </Button>
        ))}
      </section>

      {bookings !== null ? (
        <section className={styles.loyalty} aria-labelledby="loyalty-heading">
          <div className={styles.loyaltyTopline}>
            <h2 id="loyalty-heading">Loyalty reward</h2>
            <span className={styles.loyaltyCount}>
              <strong>{completedRentals}</strong> of {COMPLETED_RENTALS_BEFORE_REWARD} completed
            </span>
          </div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-label="Completed rentals toward loyalty reward"
            aria-valuemin={0}
            aria-valuemax={COMPLETED_RENTALS_BEFORE_REWARD}
            aria-valuenow={Math.min(completedRentals, COMPLETED_RENTALS_BEFORE_REWARD)}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <div className={styles.loyaltyCopy}>
            <span>
              {loyaltyRewardBooking
                ? `₱200 loyalty reward applied to ${loyaltyRewardBooking.bookingRef}.`
                : completedRentals >= COMPLETED_RENTALS_BEFORE_REWARD
                  ? `Reward unlocked—₱200 will be applied automatically to rental #${LOYALTY_REWARD_RENTAL_NUMBER}.`
                  : `${COMPLETED_RENTALS_BEFORE_REWARD - completedRentals} more completed ${COMPLETED_RENTALS_BEFORE_REWARD - completedRentals === 1 ? "rental" : "rentals"} to unlock ₱200 off.`}
            </span>
            <small>Same customer account · One returned booking equals one count · No card required</small>
          </div>
        </section>
      ) : null}

      <section className={styles.historyPanel} aria-labelledby="history-heading">
        <div className={styles.historyToolbar}>
          <div>
            <h2 id="history-heading">{FILTERS.find((item) => item.value === filter)?.label}</h2>
          </div>
          <label className={styles.searchField}>
            <span className={styles.visuallyHidden}>Search booking history</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></svg>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search reference or item"
            />
          </label>
        </div>

        {bookings === null ? (
          <div className={styles.loading}><Spinner label="Loading your bookings" /></div>
        ) : loadError ? (
          <div className={styles.empty}>
            <strong>Booking history could not be loaded.</strong>
            <p>Please refresh the page and try again.</p>
          </div>
        ) : bookings.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
            </span>
            <strong>Your booking history starts here</strong>
            <p>Choose an available rental and its dates to create your first booking reference.</p>
            <Link href="/catalog" className={styles.browseLink}>Browse Rentals</Link>
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className={styles.empty}>
            <strong>No matching bookings</strong>
            <p>Try another status or clear your search.</p>
            <Button variant="none" type="button" onClick={() => { setFilter("all"); setSearch(""); }}>Clear filters</Button>
          </div>
        ) : (
          <ul className={styles.list} aria-live="polite">
            {filteredBookings.map((booking) => (
              <li key={booking.id} className={styles.bookingCard}>
                <Link href={`/account/bookings/${booking.id}`} className={styles.cardLink}>
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
                    customerLocation={booking.fulfillmentMethod === "pickup" ? "Business pickup point" : [booking.location, booking.cityMunicipality, booking.province].filter(Boolean).join(", ")}
                    statusSlot={<StatusBadge status={booking.status} />}
                  />
                </Link>
                {/* Actions sit outside the card link so they stay valid, separately focusable controls. */}
                <div className={styles.cardFooter}>
                  <Link href={`/account/bookings/${booking.id}`} className={styles.cardFooterInfo} tabIndex={-1}>
                    <span>{getFulfillmentProgressLabel(booking.status, booking.fulfillmentMethod)}</span>
                    <p>{getBookingStatusMessage(booking.status, booking.fulfillmentMethod)}</p>
                  </Link>
                  <div className={styles.cardActions}>
                    <BookingCancelAction booking={booking} onUpdated={loadBookings} layout="inline" />
                    <Button
                      variant="primary"
                      size="none"
                      href={`/account/bookings/${booking.id}`}
                      className={styles.viewButton}
                      aria-label={`View booking ${booking.bookingRef}`}
                    >
                      View Booking
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
