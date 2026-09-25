"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "@/components/status-badge/StatusBadge";
import { createClient } from "@/src/lib/supabase/client";
import { getAllBookings } from "@/src/services/bookingService";
import type { Booking } from "@/src/types/booking";
import { useBookingRealtime } from "@/hooks/useBookingRealtime";
import {
  bookingDateKeys,
  bookingDayRole,
  buildMonthGrid,
  groupBookingsByDate,
  isCalendarBooking,
  layoutRangeSegments,
  monthCursorFromKey,
  shiftMonth,
  todayDateKey,
  type BookingDayRole,
  type MonthCursor,
} from "@/src/lib/bookingCalendar";
import { formatManilaDateTime } from "@/src/lib/rentalTiming";
import styles from "./calendar.module.css";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Booking cards shown for a day before the "Show more bookings" button appears. */
const COLLAPSED_BOOKING_LIMIT = 3;

/** Rental-range bars drawn in a day cell; any further bookings that day show as "+N more". */
const VISIBLE_RANGE_LANES = 2;

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

/** Booking numbers are matched without case, dashes or spaces, so "bk 1a2b3c" finds "BK-1A2B3C". */
function normalizeBookingNumber(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Shortest booking-number search; anything shorter would match almost every booking. */
const MIN_BOOKING_NUMBER_LENGTH = 3;

/**
 * Approved bookings whose customer name or booking number matches the search.
 * Rentals that are still coming up or in progress come first (soonest first), then past ones.
 */
function findMatchingBookings(bookings: Booking[], query: string, todayKey: string): Booking[] {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  const numberQuery = normalizeBookingNumber(text);
  const words = text.split(/\s+/);

  const matches = bookings.filter((booking) => {
    if (!isCalendarBooking(booking)) return false;
    if (
      numberQuery.length >= MIN_BOOKING_NUMBER_LENGTH &&
      normalizeBookingNumber(booking.bookingRef).includes(numberQuery)
    ) {
      return true;
    }
    const name = customerName(booking).toLowerCase();
    return words.every((word) => name.includes(word));
  });

  const startOf = (booking: Booking) => bookingDateKeys(booking)[0] ?? "";
  const endOf = (booking: Booking) => bookingDateKeys(booking).at(-1) ?? "";
  const upcoming = matches
    .filter((booking) => endOf(booking) >= todayKey)
    .sort((a, b) => startOf(a).localeCompare(startOf(b)));
  const past = matches
    .filter((booking) => endOf(booking) < todayKey)
    .sort((a, b) => startOf(b).localeCompare(startOf(a)));
  return [...upcoming, ...past];
}

function BookingCard({ booking, roleLabel }: { booking: Booking; roleLabel?: string }) {
  return (
    <article className={styles.bookingCard}>
      <div className={styles.cardTop}>
        <span className={styles.bookingId}>{booking.bookingRef}</span>
        <StatusBadge status={booking.status} />
      </div>
      <strong className={styles.customer}>{customerName(booking)}</strong>
      {roleLabel ? <span className={styles.roleTag}>{roleLabel}</span> : null}
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
      <Button
        href={`/admin/bookings/${booking.id}`}
        variant="primary"
        size="sm"
        className={styles.viewButton}
        aria-label={`View booking details for ${booking.bookingRef}, ${customerName(booking)}`}
      >
        View booking details
      </Button>
    </article>
  );
}

export default function AdminCalendar() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(() => todayDateKey());
  const [cursor, setCursor] = useState<MonthCursor>(() => monthCursorFromKey(todayDateKey()));
  const [selectedKey, setSelectedKey] = useState<string>(() => todayDateKey());
  // Tracks which day is expanded, so picking another day collapses the list again.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // `searchInput` is what the admin is typing; `appliedQuery` only changes when they press Search.
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [focusedBookingId, setFocusedBookingId] = useState<string | null>(null);

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

  useBookingRealtime({ onChange: loadBookings });

  const bookingsByDate = useMemo(() => groupBookingsByDate(bookings ?? []), [bookings]);
  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor]);
  const rangeLayout = useMemo(
    () => layoutRangeSegments(grid.map((cell) => cell.dateKey), bookingsByDate),
    [grid, bookingsByDate],
  );
  const selectedBookings = bookingsByDate.get(selectedKey) ?? [];
  const canCollapse = selectedBookings.length > COLLAPSED_BOOKING_LIMIT;
  const isExpanded = expandedKey === selectedKey;
  const visibleBookings =
    canCollapse && !isExpanded
      ? selectedBookings.slice(0, COLLAPSED_BOOKING_LIMIT)
      : selectedBookings;
  const hiddenCount = selectedBookings.length - visibleBookings.length;

  // Derived from the latest bookings, so results stay current if a booking changes while searching.
  const searchResults = useMemo(
    () => findMatchingBookings(bookings ?? [], appliedQuery, today),
    [bookings, appliedQuery, today],
  );
  const focusedBooking = searchResults.find((booking) => booking.id === focusedBookingId) ?? null;

  function goToToday() {
    const key = todayDateKey();
    setToday(key);
    setCursor(monthCursorFromKey(key));
    setSelectedKey(key);
    setFocusedBookingId(null);
  }

  function selectDay(dateKey: string, inMonth: boolean) {
    setSelectedKey(dateKey);
    setFocusedBookingId(null);
    if (!inMonth) setCursor(monthCursorFromKey(dateKey));
  }

  /** Shows one booking on the right panel and moves the calendar to its pickup day. */
  function focusBooking(booking: Booking) {
    setFocusedBookingId(booking.id);
    const pickupKey = bookingDateKeys(booking)[0];
    if (!pickupKey) return;
    setSelectedKey(pickupKey);
    setCursor(monthCursorFromKey(pickupKey));
  }

  function clearSearch() {
    setSearchInput("");
    setAppliedQuery("");
    setFocusedBookingId(null);
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchInput.trim();
    if (!query) {
      clearSearch();
      return;
    }
    setAppliedQuery(query);
    const [firstMatch] = findMatchingBookings(bookings ?? [], query, today);
    if (firstMatch) focusBooking(firstMatch);
    else setFocusedBookingId(null);
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
          <span className={styles.count}>{bookingCountLabel(selectedBookings.length)} approved</span>
        </div>
      </header>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
          <Button variant="none" type="button" onClick={() => void loadBookings()}>Try again</Button>
        </div>
      ) : null}

      {bookings ? (
        <section className={styles.searchPanel} aria-label="Find a booking">
          <form className={styles.searchForm} onSubmit={handleSearch} role="search">
            <input
              type="search"
              className={styles.searchInput}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by customer name or booking number"
              aria-label="Search by customer name or booking number"
              autoComplete="off"
            />
            <Button variant="primary" size="sm" type="submit" className={styles.searchButton}>
              Search
            </Button>
            {searchInput || appliedQuery ? (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                className={styles.searchButton}
                onClick={clearSearch}
              >
                Clear Search
              </Button>
            ) : null}
          </form>

          {appliedQuery ? (
            searchResults.length ? (
              <>
                <p className={styles.searchSummary} role="status">
                  {searchResults.length === 1
                    ? "1 matching booking"
                    : `${searchResults.length} matching bookings`}
                </p>
                <ul className={styles.resultList}>
                  {searchResults.map((booking) => {
                    const isFocused = booking.id === focusedBooking?.id;
                    return (
                      <li key={booking.id}>
                        <Button
                          variant="none"
                          type="button"
                          className={`${styles.resultItem} ${isFocused ? styles.resultItemActive : ""}`}
                          aria-pressed={isFocused}
                          onClick={() => focusBooking(booking)}
                        >
                          <span className={styles.bookingId}>{booking.bookingRef}</span>
                          <span className={styles.resultName}>{customerName(booking)}</span>
                          <span className={styles.resultDates}>{formatRentalDates(booking)}</span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className={styles.searchEmpty} role="status">No matching booking found.</p>
            )
          ) : null}
        </section>
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
                const segments = rangeLayout.get(cell.dateKey) ?? [];
                const shownSegments = segments.filter((segment) => segment.lane < VISIBLE_RANGE_LANES);
                const moreCount = segments.length - shownSegments.length;
                // Empty lanes are kept as spacers so each booking's bar lines up across the week.
                const laneSlots = Array.from(
                  { length: shownSegments.length ? shownSegments[shownSegments.length - 1].lane + 1 : 0 },
                  (_, lane) => shownSegments.find((segment) => segment.lane === lane) ?? null,
                );
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
                    {segments.length ? (
                      <span className={styles.dayRanges} aria-hidden="true">
                        {laneSlots.map((segment, lane) =>
                          segment ? (
                            <span
                              key={segment.booking.id}
                              className={[
                                styles.rangeBar,
                                segment.continuesLeft ? styles.rangeContinuesLeft : "",
                                segment.continuesRight ? styles.rangeContinuesRight : "",
                              ].filter(Boolean).join(" ")}
                              title={`${segment.booking.bookingRef} · ${customerName(segment.booking)} · ${formatRentalDates(segment.booking)}`}
                            >
                              {/* Named once where the bar starts (or where it wraps onto a new week). */}
                              {segment.continuesLeft ? null : customerName(segment.booking)}
                            </span>
                          ) : (
                            <span key={`lane-${lane}`} className={styles.rangeSpacer} />
                          ),
                        )}
                        {moreCount ? <span className={styles.rangeMore}>+{moreCount} more</span> : null}
                      </span>
                    ) : null}
                  </Button>
                );
              })}
            </div>

            <ul className={styles.legend} aria-label="Calendar key">
              <li><span className={`${styles.swatch} ${styles.swatchBooked}`} aria-hidden="true" />Has approved bookings</li>
              <li><span className={`${styles.swatch} ${styles.swatchRange}`} aria-hidden="true" />One booking across its rental dates</li>
              <li><span className={`${styles.swatch} ${styles.swatchToday}`} aria-hidden="true" />Today</li>
              <li><span className={`${styles.swatch} ${styles.swatchSelected}`} aria-hidden="true" />Selected day</li>
            </ul>
          </section>

          <aside className={styles.detailsPanel} aria-labelledby="calendar-day-heading">
            <div className={styles.detailsHeader}>
              <p className={styles.eyebrow}>{focusedBooking ? "SELECTED BOOKING" : "SELECTED DAY"}</p>
              <h2 id="calendar-day-heading">{formatDateKey(selectedKey, "long")}</h2>
              <p>
                {focusedBooking
                  ? "Showing the booking you searched for. Select a day to see everything booked on it."
                  : selectedBookings.length
                    ? `${bookingCountLabel(selectedBookings.length)} on this day`
                    : "Nothing booked on this day."}
              </p>
            </div>

            {focusedBooking ? (
              <ul className={styles.bookingList}>
                <li>
                  <BookingCard booking={focusedBooking} />
                </li>
              </ul>
            ) : selectedBookings.length ? (
              <>
                <ul className={styles.bookingList} id="calendar-booking-list">
                  {visibleBookings.map((booking) => (
                    <li key={booking.id}>
                      <BookingCard
                        booking={booking}
                        roleLabel={ROLE_LABELS[bookingDayRole(booking, selectedKey)]}
                      />
                    </li>
                  ))}
                </ul>
                {canCollapse ? (
                  <div className={styles.listFooter}>
                    <span className={styles.listSummary} aria-live="polite">
                      Showing {visibleBookings.length} of {selectedBookings.length}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      className={styles.toggleButton}
                      aria-expanded={isExpanded}
                      aria-controls="calendar-booking-list"
                      onClick={() => setExpandedKey(isExpanded ? null : selectedKey)}
                    >
                      {isExpanded ? "Show less" : `Show more bookings (${hiddenCount})`}
                    </Button>
                  </div>
                ) : null}
              </>
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
