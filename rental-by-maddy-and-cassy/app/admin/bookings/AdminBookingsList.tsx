"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/src/lib/supabase/client";
import { getAllBookings } from "@/src/services/bookingService";
import { getAllUsers } from "@/src/services/userService";
import type { Booking, BookingStatus, UserProfile } from "@/src/types/database";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "@/components/status-badge/StatusBadge";
import {
  getBookingLiveStatusLabel,
  useBookingRealtime,
} from "@/hooks/useBookingRealtime";
import {
  bookingMatchesHistoryFilter,
  getBookingHistoryGroup,
  getFulfillmentProgressLabel,
  type BookingHistoryFilter,
} from "@/src/lib/bookingManagement";
import { bookingHeadline } from "@/src/lib/bookingDisplay";
import { resolveAccountName } from "@/src/lib/accountDisplay";
import GuestBadge from "@/components/status-badge/GuestBadge";
import styles from "./bookings.module.css";

const STATUS_OPTIONS: Array<{ value: "" | BookingStatus; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending Review" },
  { value: "approved", label: "Approved" },
  { value: "confirmed", label: "Confirmed" },
  { value: "ready_for_release", label: "Ready for Handover" },
  { value: "released", label: "Released" },
  { value: "returned", label: "Returned / Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function formatDate(value: string | undefined | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function customerName(booking: Booking, user?: UserProfile): string {
  const snapshotName = booking.customerSnapshot?.fullName?.trim();
  if (snapshotName) return snapshotName;
  if (user) return resolveAccountName(user);
  const snapshotEmail = booking.customerSnapshot?.email?.trim();
  if (snapshotEmail) return snapshotEmail;
  return "Guest";
}

export default function AdminBookingsList() {
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | BookingStatus>("");
  const [historyFilter, setHistoryFilter] = useState<BookingHistoryFilter>("all");
  const [error, setError] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    // Bookings and users are fetched independently: each booking already
    // carries its own customerSnapshot (see assembleBooking), so a failure
    // loading the separate full user list (used only as a display-name/email
    // fallback) must never hide bookings that loaded successfully.
    const supabase = createClient();
    try {
      const bookingRecords = await getAllBookings(supabase);
      setBookings(bookingRecords);
      setError(null);
    } catch {
      setError("Bookings could not be loaded. Please refresh and try again.");
    }

    try {
      const userRecords = await getAllUsers();
      setUsers(userRecords);
    } catch {
      // Non-fatal: booking rows still render using their own customerSnapshot.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBookings();
  }, [loadBookings]);

  const liveStatus = useBookingRealtime({ onChange: loadBookings });

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  const filteredBookings = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (bookings ?? []).filter((booking) => {
      if (!bookingMatchesHistoryFilter(booking, historyFilter)) return false;
      if (status && booking.status !== status) return false;
      if (!query) return true;

      const user = usersById.get(booking.customerId);
      return [
        booking.bookingRef,
        ...booking.items.map((item) => item.productName),
        customerName(booking, user),
        booking.customerSnapshot?.email,
        user?.email,
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [bookings, historyFilter, search, status, usersById]);

  const summaryCounts = useMemo(() => {
    const records = bookings ?? [];
    return {
      all: records.length,
      ongoing: records.filter((booking) => getBookingHistoryGroup(booking.status) === "ongoing").length,
      completed: records.filter((booking) => getBookingHistoryGroup(booking.status) === "completed").length,
      cancelled: records.filter((booking) => getBookingHistoryGroup(booking.status) === "cancelled").length,
    };
  }, [bookings]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>BOOKING MANAGEMENT</p>
          <h1>Customer Bookings</h1>
          <p>Review submitted details, verify requirements, and manage rental statuses.</p>
        </div>
        <div className={styles.headerMeta}>
          <span className={`${styles.liveStatus} ${styles[liveStatus]}`}>
            <span aria-hidden="true" />{getBookingLiveStatusLabel(liveStatus)}
          </span>
          <span className={styles.count}>{bookings?.length ?? 0} bookings</span>
        </div>
      </header>

      <section className={styles.summaryGrid} aria-label="Booking management summary">
        {([
          ["all", "All Bookings", "Complete booking history"],
          ["ongoing", "Ongoing", "Requests and active rentals"],
          ["completed", "Completed", "Returned rentals"],
          ["cancelled", "Cancelled", "Cancelled or declined"],
        ] as const).map(([value, label, description]) => (
          <button
            key={value}
            type="button"
            className={`${styles.summaryCard} ${historyFilter === value ? styles.summaryCardActive : ""}`}
            onClick={() => setHistoryFilter(value)}
            aria-pressed={historyFilter === value}
          >
            <span>{label}</span>
            <strong>{summaryCounts[value]}</strong>
            <small>{description}</small>
          </button>
        ))}
      </section>

      <section className={styles.panel} aria-labelledby="booking-list-heading">
        <div className={styles.toolbar}>
          <div>
            <h2 id="booking-list-heading">All Booking Requests</h2>
            <p>Select a booking to view every submitted detail and take action.</p>
          </div>
          <div className={styles.filters}>
            <label>
              <span className={styles.visuallyHidden}>Search bookings</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search booking, customer, or item"
              />
            </label>
            <label>
              <span className={styles.visuallyHidden}>Filter bookings by status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as "" | BookingStatus)}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {error ? (
          <div className={styles.error} role="alert">
            {error}
            <button type="button" onClick={() => void loadBookings()}>Try again</button>
          </div>
        ) : null}

        {!bookings && !error ? (
          <div className={styles.loading}>
            <Spinner size={28} label="Loading bookings" />
          </div>
        ) : filteredBookings.length ? (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Customer</th>
                  <th>Rental Item</th>
                  <th>Dates</th>
                  <th>Status</th>
                  <th>Fulfillment Update</th>
                  <th>Submitted</th>
                  <th className={styles.actionCell} aria-label="Open booking" />
                </tr>
              </thead>
              <tbody>
                {filteredBookings.map((booking) => {
                  const user = usersById.get(booking.customerId);
                  const href = `/admin/bookings/${booking.id}`;
                  const goToBooking = () => router.push(href);
                  const stopRowNav = (event: React.MouseEvent) => event.stopPropagation();
                  return (
                    <tr
                      key={booking.id}
                      className={styles.row}
                      tabIndex={0}
                      role="link"
                      aria-label={`Open booking ${booking.bookingRef}`}
                      onClick={goToBooking}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          goToBooking();
                        }
                      }}
                    >
                      <td data-label="Booking">
                        <Link href={href} className={styles.bookingLink} onClick={stopRowNav}>
                          {booking.bookingRef}
                        </Link>
                      </td>
                      <td data-label="Customer">
                        <strong className={styles.customerNameRow}>
                          {customerName(booking, user)}
                          {booking.isGuestCheckout ? <GuestBadge /> : null}
                        </strong>
                        <small>{booking.customerSnapshot?.email || user?.email || "-"}</small>
                      </td>
                      <td data-label="Rental Item">{bookingHeadline(booking.items)}</td>
                      <td data-label="Dates">
                        {formatDate(booking.startDate)} - {formatDate(booking.endDate)}
                      </td>
                      <td data-label="Status"><StatusBadge status={booking.status} /></td>
                      <td data-label="Fulfillment Update">
                        <strong>{getFulfillmentProgressLabel(booking.status, booking.fulfillmentMethod)}</strong>
                        <small>{booking.fulfillmentMethod === "delivery" ? "Delivery" : "Pickup"}</small>
                      </td>
                      <td data-label="Submitted">{formatDate(booking.createdAt)}</td>
                      <td data-label="Action" className={styles.actionCell}>
                        <Link href={href} className={styles.openLink} onClick={stopRowNav}>
                          Review
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>
            {bookings && bookings.length === 0
              ? "No bookings have been submitted yet."
              : "No bookings match the selected filters."}
          </p>
        )}
      </section>
    </div>
  );
}
