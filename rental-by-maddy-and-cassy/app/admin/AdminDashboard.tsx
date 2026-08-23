"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "@/components/status-badge/StatusBadge";
import GuestBadge from "@/components/status-badge/GuestBadge";
import {
  getAdminDashboard,
  type AdminDashboardData,
} from "@/src/services/operationsService";
import styles from "./admin.module.css";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface PriorityCard {
  key: string;
  label: string;
  value: string;
  caption: string;
  cta: string;
  href: string;
  urgent: boolean;
}

interface SecondaryCard {
  key: string;
  label: string;
  value: string;
  caption: string;
  href?: string;
}

export default function AdminDashboard() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!user) return;

    getAdminDashboard()
      .then((dashboard) => {
        if (active) setData(dashboard);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The dashboard data could not be loaded. Please refresh and try again.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [user]);

  const displayName = profile?.displayName ?? (user?.user_metadata?.display_name as string | undefined) ?? "Administrator";

  const priorityCards: PriorityCard[] = data
    ? [
        {
          key: "pendingReviews",
          label: "Pending Reviews",
          value: String(data.metrics.pendingVerification),
          caption: "Submitted or correction-required bookings",
          cta: "Review requirements",
          href: "/admin/bookings",
          urgent: data.metrics.pendingVerification > 0,
        },
        {
          key: "activeBookings",
          label: "Active Bookings",
          value: String(data.metrics.activeBookings),
          caption: "Currently in progress",
          cta: "Manage open bookings",
          href: "/admin/bookings",
          urgent: false,
        },
        {
          key: "failedPayments",
          label: "Failed Payments",
          value: String(data.metrics.failedPayments),
          caption: "Checkout attempts requiring attention",
          cta: "Review payment activity",
          href: "/admin/payments",
          urgent: data.metrics.failedPayments > 0,
        },
        {
          key: "verifiedRevenue",
          label: "Verified Revenue",
          value: `PHP ${data.metrics.verifiedRevenue.toLocaleString("en-PH")}`,
          caption: "Confirmed GCash payments",
          cta: "View payment activity",
          href: "/admin/payments",
          urgent: false,
        },
      ]
    : [];

  const secondaryCards: SecondaryCard[] = data
    ? [
        {
          key: "customerAccounts",
          label: "Customer Accounts",
          value: String(data.metrics.customerAccounts),
          caption: "Registered renters",
          href: "/admin/users",
        },
        {
          key: "successfulPayments",
          label: "Successful Payments",
          value: String(data.metrics.successfulPayments),
          caption: "Verified GCash payments",
        },
        {
          key: "catalogProducts",
          label: "Catalog Products",
          value: String(data.metrics.catalogProducts),
          caption: "Active and inactive catalog records",
        },
        {
          key: "completedRentals",
          label: "Completed Rentals",
          value: String(data.metrics.completedRentals),
          caption: "Recorded rental history",
        },
        {
          key: "mostRequested",
          label: "Most Requested Gadget",
          value: data.metrics.popularProductName ?? "—",
          caption: data.metrics.popularProductName
            ? `${data.metrics.popularProductBookings} booking request(s)`
            : "No booking data yet",
        },
      ]
    : [];

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>ADMIN DASHBOARD</p>
          <h1>Welcome, {displayName}</h1>
          <p>Monitor customer accounts, bookings, and rental catalog activity.</p>
        </div>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}

      {!data && !error ? (
        <div className={styles.loading}>
          <Spinner size={28} label="Loading admin dashboard" />
        </div>
      ) : data ? (
        <>
          <p className={styles.sectionLabel}>Needs Your Attention</p>
          <section className={styles.priorityMetrics} aria-label="Actionable metrics">
            {priorityCards.map((card) => (
              <Link
                key={card.key}
                href={card.href}
                className={`${styles.priorityCard} ${card.urgent ? styles.urgent : ""}`}
              >
                <span className={styles.priorityLabel}>
                  {card.label}
                  {card.urgent ? <span className={styles.priorityFlag}>Action needed</span> : null}
                </span>
                <strong>{card.value}</strong>
                <span className={styles.priorityCaption}>{card.caption}</span>
                <span className={styles.priorityCta}>{card.cta} →</span>
              </Link>
            ))}
          </section>

          <p className={styles.sectionLabel}>Business Snapshot</p>
          <section className={styles.secondaryMetrics} aria-label="Secondary metrics">
            {secondaryCards.map((card) =>
              card.href ? (
                <Link key={card.key} href={card.href} className={styles.secondaryCard}>
                  <span className={styles.secondaryLabel}>{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.caption}</small>
                </Link>
              ) : (
                <article key={card.key} className={styles.secondaryCard}>
                  <span className={styles.secondaryLabel}>{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.caption}</small>
                </article>
              ),
            )}
          </section>

          <section className={styles.panel} aria-labelledby="recent-bookings-heading">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="recent-bookings-heading">Recent Booking Activity</h2>
                <p>Newest and pending-review bookings across all customer accounts.</p>
              </div>
              <Link href="/admin/bookings">View all bookings</Link>
            </div>

            {data.recentBookings.length ? (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Booking</th>
                      <th>Customer</th>
                      <th>Product</th>
                      <th>Status</th>
                      <th>Submitted</th>
                      <th className={styles.actionCell} aria-label="Open booking" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentBookings.map((booking) => {
                      const href = `/admin/bookings/${booking.id}`;
                      const isClosed = booking.status === "rejected" || booking.status === "cancelled";
                      const isPendingReview = booking.requirementsStatus === "pending_review" && !isClosed;
                      const goToBooking = () => router.push(href);
                      const stopRowNav = (event: React.MouseEvent) => event.stopPropagation();
                      return (
                        <tr
                          key={booking.id}
                          className={`${styles.row} ${isPendingReview ? styles.rowPending : ""}`}
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
                            <span className={styles.customerNameRow}>
                              {booking.customerName}
                              {booking.isGuestCheckout ? <GuestBadge /> : null}
                            </span>
                          </td>
                          <td data-label="Product">{booking.productName}</td>
                          <td data-label="Status">
                            <span className={styles.statusCell}>
                              <StatusBadge status={booking.status} />
                              {isPendingReview ? (
                                <span className={styles.reviewFlag}>Needs review</span>
                              ) : null}
                            </span>
                          </td>
                          <td data-label="Submitted">{formatDate(booking.createdAt)}</td>
                          <td data-label="Action" className={styles.actionCell}>
                            <Link href={href} className={styles.openLink} onClick={stopRowNav}>
                              {isPendingReview ? "Review" : "View"}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.empty}>No booking activity has been recorded yet.</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
