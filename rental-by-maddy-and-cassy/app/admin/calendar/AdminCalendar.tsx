"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "@/components/status-badge/StatusBadge";
import { createClient } from "@/src/lib/supabase/client";
import { getAllBookings } from "@/src/services/bookingService";
import type { Booking } from "@/src/types/booking";
import {
  getBookingLiveStatusLabel,
  useBookingRealtime,
} from "@/hooks/useBookingRealtime";
import {
  bookingDayRole,
  buildMonthGrid,
  groupBookingsByDate,
  isCalendarBooking,
  monthCursorFromKey,
  shiftMonth,
  todayDateKey,
  type BookingDayRole,
  type MonthCursor,
} from "@/src/lib/bookingCalendar";
import { formatManilaDateTime } from "@/src/lib/rentalTiming";
import styles from "./calendar.module.css";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ROLE_LABELS: Record<BookingDayRole, string> = {
  pickup: "Pickup day",
  return: "Return day",
  pickup_and_return: "Pickup and return day",
  ongoing: "Rental in progress",
};

function formatMonthTitle(cursor: MonthCursor): string {
  return new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString("en-PH", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

function formatDateKey(dateKey: string, style: "long" | "short"): string {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-PH", {
    timeZone: "UTC",
    ...(style === "long"
      ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
      : { month: "long", day: "numeric", year: "numeric" }),
  });
}

function formatRentalDates(booking: Booking): string {
  const format = (value: string) =>
    new Date(value).toLocaleDateString("en-PH", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  if (!booking.startDate) return "-";
  const start = format(booking.startDate);
  const end = booking.endDate ? format(booking.endDate) : start;
  return start === end ? start : `${start} – ${end}`;
}

function customerName(booking: Booking): string {
  return (
    booking.customerSnapshot?.fullName?.trim() ||
    booking.customerSnapshot?.email?.trim() ||
    "Guest"
  );
}

function itemsLabel(booking: Booking): string {
  if (!booking.items.length) return booking.productSnapshot?.name || "Rental item";
  return booking.items
    .map((item) => (item.quantity > 1 ? `${item.productName} ×${item.quantity}` : item.productName))
    .join(", ");
}

function bookingCountLabel(count: number): string {
  return `${count} ${count === 1 ? "booking" : "bookings"}`;
}

export default function AdminCalendar() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(() => todayDateKey());
  const [cursor, setCursor] = useState<MonthCursor>(() => monthCursorFromKey(todayDateKey()));
  const [selectedKey, setSelectedKey] = useState<string>(() => todayDateKey());

  const loadBookings = useCallback(async () => {
    try {
      const records = await getAllBookings(createClient());
      setBookings(records);
      setError(null);
    } catch {
      setError("Bookings could not be loaded. Please refresh and try again.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBookings();
  }, [loadBookings]);

  const liveStatus = useBookingRealtime({ onChange: loadBookings });

  const bookingsByDate = useMemo(() => groupBookingsByDate(bookings ?? []), [bookings]);
  const approvedCount = useMemo(
    () => (bookings ?? []).filter(isCalendarBooking).length,
    [bookings],
  );
  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor]);
  const selectedBookings = bookingsByDate.get(selectedKey) ?? [];

  function goToToday() {
    const key = todayDateKey();
    setToday(key);
    setCursor(monthCursorFromKey(key));
    setSelectedKey(key);
  }

  function selectDay(dateKey: string, inMonth: boolean) {
    setSelectedKey(dateKey);
    if (!inMonth) setCursor(monthCursorFromKey(dateKey));
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>RENTAL CALENDAR</p>
          <h1>Calendar</h1>
          <p>See which days have approved rentals. Select a day to view its bookings.</p>
        </div>
        <div className={styles.headerMeta}>
          <span className={`${styles.liveStatus} ${styles[liveStatus]}`}>
            <span aria-hidden="true" />{getBookingLiveStatusLabel(liveStatus)}
          </span>
          <span className={styles.count}>{bookingCountLabel(approvedCount)} approved</span>
        </div>
      </header>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
          <Button variant="none" type="button" onClick={() => void loadBookings()}>Try again</Button>
        </div>
      ) : null}

      {!bookings && !error ? (
        <div className={styles.loading}>
          <Spinner size={28} label="Loading calendar" />
        </div>
      ) : (
        <div className={styles.layout}>
          <section className={styles.calendarPanel} aria-label="Month calendar">
            <div className={styles.calendarToolbar}>
              <h2 aria-live="polite">{formatMonthTitle(cursor)}</h2>
              <div className={styles.monthControls}>
                <Button
                  variant="none"
                  type="button"
                  className={styles.controlButton}
                  onClick={() => setCursor((current) => shiftMonth(current, -1))}
                >
                  Previous Month
                </Button>
                <Button
                  variant="none"
                  type="button"
                  className={`${styles.controlButton} ${styles.todayButton}`}
                  onClick={goToToday}
                >
                  Today
                </Button>
                <Button
                  variant="none"
                  type="button"
                  className={styles.controlButton}
                  onClick={() => setCursor((current) => shiftMonth(current, 1))}
                >
                  Next Month
                </Button>
              </div>
            </div>

            <div className={styles.weekdays} aria-hidden="true">
              {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
            </div>

            <div className={styles.grid}>
              {grid.map((cell) => {
                const count = bookingsByDate.get(cell.dateKey)?.length ?? 0;
                const classNames = [
                  styles.day,
                  cell.inMonth ? "" : styles.dayOutside,
                  count ? styles.dayBooked : "",
                  cell.dateKey === today ? styles.dayToday : "",
                  cell.dateKey === selectedKey ? styles.daySelected : "",
                ].filter(Boolean).join(" ");
                return (
                  <Button
                    key={cell.dateKey}
                    variant="none"
                    type="button"
                    className={classNames}
                    aria-pressed={cell.dateKey === selectedKey}
                    aria-label={`${formatDateKey(cell.dateKey, "short")}, ${
                      count ? `${bookingCountLabel(count)} booked` : "no bookings"
                    }`}
                    onClick={() => selectDay(cell.dateKey, cell.inMonth)}
                  >
                    <span className={styles.dayNumber}>{cell.day}</span>
                    {count ? <span className={styles.dayCount}>{bookingCountLabel(count)}</span> : null}
                  </Button>
                );
              })}
            </div>

            <ul className={styles.legend} aria-label="Calendar key">
              <li><span className={`${styles.swatch} ${styles.swatchBooked}`} aria-hidden="true" />Has approved bookings</li>
              <li><span className={`${styles.swatch} ${styles.swatchToday}`} aria-hidden="true" />Today</li>
              <li><span className={`${styles.swatch} ${styles.swatchSelected}`} aria-hidden="true" />Selected day</li>
            </ul>
          </section>

          <aside className={styles.detailsPanel} aria-labelledby="calendar-day-heading">
            <div className={styles.detailsHeader}>
              <p className={styles.eyebrow}>SELECTED DAY</p>
              <h2 id="calendar-day-heading">{formatDateKey(selectedKey, "long")}</h2>
              <p>
                {selectedBookings.length
                  ? `${bookingCountLabel(selectedBookings.length)} on this day`
                  : "Nothing booked on this day."}
              </p>
            </div>

            {selectedBookings.length ? (
              <ul className={styles.bookingList}>
                {selectedBookings.map((booking) => {
                  const role = bookingDayRole(booking, selectedKey);
                  return (
                    <li key={booking.id}>
                      <Link
                        href={`/admin/bookings/${booking.id}`}
                        className={styles.bookingCard}
                        aria-label={`Open booking ${booking.bookingRef} for ${customerName(booking)}`}
                      >
                        <div className={styles.cardTop}>
                          <span className={styles.bookingId}>{booking.bookingRef}</span>
                          <StatusBadge status={booking.status} />
                        </div>
                        <strong className={styles.customer}>{customerName(booking)}</strong>
                        <span className={styles.roleTag}>{ROLE_LABELS[role]}</span>
                        <dl className={styles.facts}>
                          <div><dt>Rental item</dt><dd>{itemsLabel(booking)}</dd></div>
                          <div><dt>Rental dates</dt><dd>{formatRentalDates(booking)}</dd></div>
                          <div>
                            <dt>{booking.fulfillmentMethod === "delivery" ? "Delivery" : "Pickup"}</dt>
                            <dd>{booking.startDate ? formatManilaDateTime(booking.startDate) : "-"}</dd>
                          </div>
                          <div>
                            <dt>Return</dt>
                            <dd>{booking.endDate ? formatManilaDateTime(booking.endDate) : "-"}</dd>
                          </div>
                        </dl>
                        <span className={styles.viewLink}>View booking details →</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.empty}>
                Pick a highlighted day to see its approved bookings.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
