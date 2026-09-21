"use client";

import { Button } from "@/components/ui/Button";
import { useEffect, useState, type ReactNode } from "react";
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
import { friendlyMessage } from "@/src/lib/friendlyMessage";
import styles from "./admin.module.css";

const PAGE_SIZE = 10;

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function paginate<T>(items: T[], page: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  return {
    currentPage,
    totalPages,
    start,
    items: items.slice(start, start + PAGE_SIZE),
  };
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

interface CollapsibleSectionProps {
  id: string;
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  badge?: ReactNode;
  action?: ReactNode;
  attention?: boolean;
  className?: string;
  children: ReactNode;
}

function CollapsibleSection({
  id,
  title,
  description,
  open,
  onToggle,
  badge,
  action,
  attention = false,
  className = "",
  children,
}: CollapsibleSectionProps) {
  const bodyId = `${id}-body`;
  return (
    <section
      id={id}
      className={`${styles.panel} ${attention ? styles.panelAttention : ""} ${className}`}
      aria-labelledby={`${id}-heading`}
    >
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>
          <div className={styles.panelTitleRow}>
            <h2 id={`${id}-heading`}>{title}</h2>
            {badge}
          </div>
          <p>{description}</p>
        </div>
        <div className={styles.panelActions}>
          {action}
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={onToggle}
          >
            {open ? "Hide" : "Show"}
          </Button>
        </div>
      </div>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

interface PaginationProps {
  label: string;
  page: number;
  totalPages: number;
  totalItems: number;
  start: number;
  shown: number;
  onPageChange: (page: number) => void;
}

function Pagination({ label, page, totalPages, totalItems, start, shown, onPageChange }: PaginationProps) {
  if (totalItems <= PAGE_SIZE) return null;
  return (
    <nav className={styles.pagination} aria-label={`${label} pages`}>
      <span className={styles.paginationSummary}>
        Showing {start + 1}–{start + shown} of {totalItems}
      </span>
      <div className={styles.paginationControls}>
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span className={styles.paginationPage}>
          Page {page} of {totalPages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [cancellationsOpen, setCancellationsOpen] = useState(true);
  const [bookingsOpen, setBookingsOpen] = useState(true);
  const [cancellationPage, setCancellationPage] = useState(1);
  const [bookingPage, setBookingPage] = useState(1);

  useEffect(() => {
    let active = true;
    if (!user) return;

    getAdminDashboard()
      .then((dashboard) => {
        if (active) {
          setData(dashboard);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? friendlyMessage(loadError.message, "error")
              : "We couldn't load the dashboard. Please refresh the page and try again.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [user, retryCount]);

  const displayName = profile?.displayName ?? (user?.user_metadata?.display_name as string | undefined) ?? "Administrator";

  const priorityCards: PriorityCard[] = data
    ? [
        {
          key: "pendingReviews",
          label: "Pending Reviews",
          value: String(data.metrics.pendingVerification),
          caption: "Bookings waiting for your review",
          cta: "Review requirements",
          href: "/admin/bookings",
          urgent: data.metrics.pendingVerification > 0,
        },
        {
          key: "cancellationRequests",
          label: "Cancellation Requests",
          value: String(data.metrics.pendingCancellations),
          caption: "Customers asking to cancel",
          cta: "Review cancellation requests",
          href: "#cancellation-requests",
          urgent: data.metrics.pendingCancellations > 0,
        },
        {
          key: "activeBookings",
          label: "Active Bookings",
          value: String(data.metrics.activeBookings),
          caption: "Rentals currently in progress",
          cta: "Manage open bookings",
          href: "/admin/bookings",
          urgent: false,
        },
        {
          key: "failedPayments",
          label: "Failed Payments",
          value: String(data.metrics.failedPayments),
          caption: "Payments that did not go through",
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
          caption: "Confirmed GCash payments",
        },
        {
          key: "catalogProducts",
          label: "Catalog Products",
          value: String(data.metrics.catalogProducts),
          caption: "Gadgets in your catalog",
        },
        {
          key: "completedRentals",
          label: "Completed Rentals",
          value: String(data.metrics.completedRentals),
          caption: "Rentals returned so far",
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

  const cancellations = data ? paginate(data.cancellationRequests, cancellationPage) : null;
  const bookings = data ? paginate(data.recentBookings, bookingPage) : null;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>ADMIN DASHBOARD</p>
          <h1>Welcome, {displayName}</h1>
          <p>See what needs your attention and how your rentals are doing.</p>
        </div>
      </header>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
          <Button variant="none" type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</Button>
        </div>
      ) : null}

      {!data && !error ? (
        <div className={styles.loading}>
          <Spinner size={28} label="Loading admin dashboard" />
        </div>
      ) : data && cancellations && bookings ? (
        <>
          <p className={styles.sectionLabel}>Needs Your Attention</p>
          <section className={styles.priorityMetrics} aria-label="Actionable metrics">
            {priorityCards.map((card) => (
              <Link
                key={card.key}
                href={card.href}
                className={`${styles.priorityCard} ${card.urgent ? styles.urgent : ""}`}
                onClick={card.key === "cancellationRequests" ? () => setCancellationsOpen(true) : undefined}
              >
                <span className={styles.priorityLabel}>
                  {card.label}
                  {card.urgent ? <span className={styles.priorityFlag}>Action needed</span> : null}
                </span>
                <strong>{card.value}</strong>
                <span className={styles.priorityCaption}>{card.caption}</span>
                <span className={styles.priorityCta}>{card.cta}</span>
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

          <CollapsibleSection
            id="cancellation-requests"
            className={styles.cancellationPanel}
            title="Cancellation Requests"
            description="Customers waiting for you to approve or decline their cancellation."
            open={cancellationsOpen}
            onToggle={() => setCancellationsOpen((open) => !open)}
            attention={data.cancellationRequests.length > 0}
            badge={
              data.cancellationRequests.length > 0 ? (
                <span className={`${styles.countBadge} ${styles.countBadgeAttention}`}>
                  {data.cancellationRequests.length} waiting
                </span>
              ) : null
            }
          >
            {data.cancellationRequests.length ? (
              <>
                <div className={styles.tableWrapper}>
                  <table className={`${styles.table} ${styles.cancellationTable}`}>
                    <thead>
                      <tr>
                        <th scope="col">Booking ID</th>
                        <th scope="col">Customer</th>
                        <th scope="col">Product</th>
                        <th scope="col">Cancellation reason</th>
                        <th scope="col">Request date</th>
                        <th scope="col">Status</th>
                        <th scope="col" className={styles.actionCell}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cancellations.items.map((request) => {
                        const href = `/admin/bookings/${request.bookingId}`;
                        return (
                          <tr key={request.id} className={styles.cancellationRow}>
                            <td data-label="Booking ID">
                              <Link href={href} className={styles.bookingLink}>{request.bookingRef}</Link>
                            </td>
                            <td data-label="Customer">{request.customerName}</td>
                            <td data-label="Product">{request.productName}</td>
                            <td data-label="Cancellation reason">{request.reason}</td>
                            <td data-label="Request date">{formatDate(request.requestedAt)}</td>
                            <td data-label="Status"><StatusBadge label="Pending" tone="yellow" /></td>
                            <td data-label="Action" className={styles.actionCell}>
                              <Link
                                href={href}
                                className={styles.openLink}
                                aria-label={`Review cancellation request for ${request.bookingRef}`}
                              >
                                Review
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  label="Cancellation requests"
                  page={cancellations.currentPage}
                  totalPages={cancellations.totalPages}
                  totalItems={data.cancellationRequests.length}
                  start={cancellations.start}
                  shown={cancellations.items.length}
                  onPageChange={setCancellationPage}
                />
              </>
            ) : (
              <p className={styles.empty}>No pending cancellation requests.</p>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            id="recent-bookings"
            title="Recent Booking Activity"
            description="Newest bookings first, with the ones waiting for your review at the top."
            open={bookingsOpen}
            onToggle={() => setBookingsOpen((open) => !open)}
            badge={
              data.recentBookings.length > 0 ? (
                <span className={styles.countBadge}>{data.recentBookings.length} bookings</span>
              ) : null
            }
            action={
              <Button href="/admin/bookings" variant="secondary" size="sm">
                View all bookings
              </Button>
            }
          >
            {data.recentBookings.length ? (
              <>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Booking</th>
                        <th>Customer</th>
                        <th>Customer Type</th>
                        <th>Product</th>
                        <th>Status</th>
                        <th>Submitted</th>
                        <th className={styles.actionCell} aria-label="Open booking" />
                      </tr>
                    </thead>
                    <tbody>
                      {bookings.items.map((booking) => {
                        const href = `/admin/bookings/${booking.id}`;
                        const isClosed = booking.status === "rejected" || booking.status === "cancelled";
                        const isPendingReview = booking.requirementsStatus === "pending_review" && !isClosed;
                        const goToBooking = () => router.push(href);
                        const stopRowNav = (event: React.MouseEvent) => event.stopPropagation();
                        return (
                          <tr
                            key={booking.id}
                            className={`${styles.row} ${isPendingReview ? styles.needsAttention : ""}`}
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
                              <span className={styles.customerCell}>
                                <span className={styles.customerNameRow}>{booking.customerName}</span>
                              </span>
                            </td>
                            <td data-label="Customer Type">
                              <span className={styles.accountTypeRow}>
                                {booking.isGuestCheckout ? (
                                  <GuestBadge />
                                ) : (
                                  <StatusBadge label="Account" tone="green" />
                                )}
                              </span>
                            </td>
                            <td data-label="Product">{booking.productName}</td>
                            <td data-label="Status">
                              <StatusBadge status={booking.status} />
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
                <Pagination
                  label="Recent bookings"
                  page={bookings.currentPage}
                  totalPages={bookings.totalPages}
                  totalItems={data.recentBookings.length}
                  start={bookings.start}
                  shown={bookings.items.length}
                  onPageChange={setBookingPage}
                />
              </>
            ) : (
              <p className={styles.empty}>No booking activity has been recorded yet.</p>
            )}
          </CollapsibleSection>
        </>
      ) : null}
    </div>
  );
}
