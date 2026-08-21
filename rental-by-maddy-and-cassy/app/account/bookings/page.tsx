"use client";

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
import StatusBadge from "@/components/status-badge/StatusBadge";
import Spinner from "@/components/ui/Spinner";
import {
  getBookingLiveStatusLabel,
  useBookingRealtime,
} from "@/hooks/useBookingRealtime";
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

  const liveStatus = useBookingRealtime({
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
          <p className={styles.eyebrow}>BOOKING HISTORY &amp; MANAGEMENT</p>
          <h1>My Bookings</h1>
          <p>Track every request, payment milestone, handover update, and completed rental.</p>
        </div>
        <div className={styles.heroActions}>
          <span className={`${styles.liveStatus} ${styles[liveStatus]}`}>
            <span aria-hidden="true" />{getBookingLiveStatusLabel(liveStatus)}
          </span>
          <Link href="/catalog" className={styles.newBookingLink}>Book another rental <span>→</span></Link>
        </div>
      </header>

      <section className={styles.summaryGrid} aria-label="Booking summary">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={`${styles.summaryCard} ${filter === item.value ? styles.summaryCardActive : ""}`}
            onClick={() => setFilter(item.value)}
            aria-pressed={filter === item.value}
          >
            <span>{item.label}</span>
            <strong>{counts[item.value]}</strong>
            <small>{item.value === "ongoing" ? "Needs attention or in progress" : item.value === "completed" ? "Returned rentals" : item.value === "cancelled" ? "Cancelled or declined" : "Complete history"}</small>
          </button>
        ))}
      </section>

      {bookings !== null ? (
        <section className={styles.loyalty} aria-labelledby="loyalty-heading">
          <div className={styles.loyaltyTopline}>
            <div>
              <p>SPECIAL PERK</p>
              <h2 id="loyalty-heading">Your loyalty reward progress</h2>
            </div>
            <strong>{completedRentals} of {COMPLETED_RENTALS_BEFORE_REWARD}</strong>
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
            <small>Same customer account • One returned booking equals one count • No card required</small>
          </div>
        </section>
      ) : null}

      <section className={styles.historyPanel} aria-labelledby="history-heading">
        <div className={styles.historyToolbar}>
          <div>
            <p className={styles.eyebrow}>YOUR RENTALS</p>
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
            <span className={styles.emptyIcon} aria-hidden="true">01</span>
            <strong>Your booking history starts here.</strong>
            <p>Choose an available rental and its dates to create your first booking reference.</p>
            <Link href="/catalog" className={styles.browseLink}>Browse Rentals</Link>
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className={styles.empty}>
            <strong>No matching bookings</strong>
            <p>Try another status or clear your search.</p>
            <button type="button" onClick={() => { setFilter("all"); setSearch(""); }}>Clear filters</button>
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
                  <div className={styles.cardFooter}>
                    <div>
                      <span>{getFulfillmentProgressLabel(booking.status, booking.fulfillmentMethod)}</span>
                      <p>{getBookingStatusMessage(booking.status, booking.fulfillmentMethod)}</p>
                    </div>
                    <strong>View booking <span aria-hidden="true">→</span></strong>
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
