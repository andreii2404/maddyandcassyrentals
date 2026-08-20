"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "@/components/status-badge/StatusBadge";
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

export default function AdminDashboard() {
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
          <section className={styles.metrics} aria-label="Business overview">
            <article className={styles.metricCard}>
              <span>Customer Accounts</span>
              <strong>{data.metrics.customerAccounts}</strong>
              <Link href="/admin/users">View all users</Link>
            </article>
            <article className={styles.metricCard}>
              <span>Verified Revenue</span>
              <strong>
                PHP {data.metrics.verifiedRevenue.toLocaleString("en-PH")}
              </strong>
              <Link href="/admin/payments">View payment activity</Link>
            </article>
            <article className={styles.metricCard}>
              <span>Successful Payments</span>
              <strong>{data.metrics.successfulPayments}</strong>
              <small>Verified GCash payments</small>
            </article>
            <article className={styles.metricCard}>
              <span>Failed Payments</span>
              <strong>{data.metrics.failedPayments}</strong>
              <small>Checkout attempts requiring attention</small>
            </article>
            <article className={styles.metricCard}>
              <span>Verification Queue</span>
              <strong>{data.metrics.pendingVerification}</strong>
              <small>Submitted or correction-required bookings</small>
            </article>
            <article className={styles.metricCard}>
              <span>Most Requested Gadget</span>
              <strong>{data.metrics.popularProductName ?? "—"}</strong>
              <small>
                {data.metrics.popularProductName
                  ? `${data.metrics.popularProductBookings} booking request(s)`
                  : "No booking data yet"}
              </small>
            </article>
            <article className={styles.metricCard}>
              <span>Active Bookings</span>
              <strong>{data.metrics.activeBookings}</strong>
              <Link href="/admin/bookings">Manage open bookings</Link>
            </article>
            <article className={styles.metricCard}>
              <span>Catalog Products</span>
              <strong>{data.metrics.catalogProducts}</strong>
              <small>Active and inactive catalog records</small>
            </article>
            <article className={styles.metricCard}>
              <span>Completed Rentals</span>
              <strong>{data.metrics.completedRentals}</strong>
              <small>Recorded rental history</small>
            </article>
          </section>

          <section className={styles.panel} aria-labelledby="recent-bookings-heading">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="recent-bookings-heading">Recent Booking Activity</h2>
                <p>Latest booking requests across all customer accounts.</p>
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
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentBookings.map((booking) => (
                      <tr key={booking.id}>
                        <td>
                          <Link href={`/admin/bookings/${booking.id}`}>
                            {booking.bookingRef}
                          </Link>
                        </td>
                        <td>{booking.customerName}</td>
                        <td>{booking.productName}</td>
                        <td>
                          <StatusBadge status={booking.status} />
                        </td>
                        <td>{formatDate(booking.createdAt)}</td>
                      </tr>
                    ))}
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
