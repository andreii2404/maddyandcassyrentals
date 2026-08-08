"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/src/lib/supabase/client";
import { getBookingsForUser } from "@/src/services/bookingService";
import type { Booking } from "@/src/types/booking";
import BookingSummaryCard from "@/components/booking-summary/BookingSummaryCard";
import StatusBadge from "@/components/status-badge/StatusBadge";
import Spinner from "@/components/ui/Spinner";
import styles from "./bookings.module.css";

export default function BookingsListPage() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[] | null>(null);

  useEffect(() => {
    if (!user) return;
    getBookingsForUser(createClient(), user.id).then(setBookings);
  }, [user]);

  return (
    <div className={styles.wrapper}>
      <h1 className={styles.heading}>My Bookings</h1>

      {bookings === null ? (
        <div className={styles.loading}>
          <Spinner label="Loading your bookings" />
        </div>
      ) : bookings.length === 0 ? (
        <div className={styles.empty}>
          <p>You haven&apos;t made any booking requests yet.</p>
          <Link href="/catalog" className={styles.browseLink}>
            Browse Rentals
          </Link>
        </div>
      ) : (
        <ul className={styles.list}>
          {bookings.map((booking) => (
            <li key={booking.id}>
              <Link href={`/account/bookings/${booking.id}`} className={styles.cardLink}>
                <BookingSummaryCard
                  bookingRef={booking.bookingRef}
                  productName={booking.productSnapshot.name}
                  brand={booking.productSnapshot.brand}
                  productImage={booking.productSnapshot.image}
                  pricePerDay={booking.productSnapshot.pricePerDay}
                  currency={booking.productSnapshot.currency}
                  startDate={new Date(booking.startDate)}
                  endDate={new Date(booking.endDate)}
                  dayCount={booking.dayCount}
                  quantity={booking.quantity}
                  fulfillmentMethod={booking.fulfillmentMethod}
                  customerLocation={booking.location ?? ""}
                  statusSlot={<StatusBadge status={booking.status} />}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
