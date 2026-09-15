"use client";

import { Button } from "@/components/ui/Button";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import Spinner from "@/components/ui/Spinner";
import StatusBadge, { type StatusTone } from "@/components/status-badge/StatusBadge";
import PaymentProofModal, { type PaymentWithProof } from "@/components/admin/PaymentProofModal";
import { useAuth } from "@/hooks/useAuth";
import { useBookingRealtime } from "@/hooks/useBookingRealtime";
import { resolveAccountName } from "@/src/lib/accountDisplay";
import {
  getAdminPayments,
  type AdminPaymentsData,
  type AdminPaymentsFilters,
} from "@/src/services/operationsService";
import type { AdminPaymentRecord } from "@/src/types/payment";
import styles from "../operations.module.css";

/** Tables whose changes affect this page's records, cards, or filters. */
const PAYMENTS_REALTIME_TABLES = ["booking_payment_submissions", "bookings"];

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

const PAYMENT_STATUS_TONES: Record<AdminPaymentRecord["status"], StatusTone> = {
  submitted: "red",
  under_review: "yellow",
  verified: "green",
  rejected: "red",
  void: "neutral",
};

const PAYMENT_STATUS_LABELS: Partial<Record<AdminPaymentRecord["status"], string>> = {
  submitted: "Unverified",
};

const DEFAULT_FILTERS: AdminPaymentsFilters = {
  status: undefined,
  stage: undefined,
  accountType: undefined,
  bookingStatus: undefined,
  proof: undefined,
  sort: "newest",
};

const STATUS_FILTER_OPTIONS: Array<{ value: NonNullable<AdminPaymentsFilters["status"]> | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "verified", label: "Verified" },
  { value: "unverified", label: "Unverified" },
  { value: "rejected", label: "Rejected" },
];

const STAGE_FILTER_OPTIONS: Array<{ value: NonNullable<AdminPaymentsFilters["stage"]> | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "full_payment", label: "Full Payment" },
  { value: "down_payment", label: "Down Payment" },
  { value: "balance", label: "Balance" },
  { value: "other", label: "Other" },
];

const ACCOUNT_TYPE_FILTER_OPTIONS: Array<{
  value: NonNullable<AdminPaymentsFilters["accountType"]> | "all";
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "with_account", label: "With Account" },
  { value: "guest", label: "Guest" },
];

const BOOKING_STATUS_FILTER_OPTIONS: Array<{
  value: NonNullable<AdminPaymentsFilters["bookingStatus"]> | "all";
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "returned", label: "Returned" },
  { value: "cancelled", label: "Cancelled" },
];

const PROOF_FILTER_OPTIONS: Array<{ value: NonNullable<AdminPaymentsFilters["proof"]> | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "with_proof", label: "With Proof" },
  { value: "no_proof", label: "No Proof" },
];

const SORT_FILTER_OPTIONS: Array<{ value: NonNullable<AdminPaymentsFilters["sort"]>; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
];

function isDefaultFilters(filters: AdminPaymentsFilters): boolean {
  return (
    !filters.status &&
    !filters.stage &&
    !filters.accountType &&
    !filters.bookingStatus &&
    !filters.proof &&
    (filters.sort ?? "newest") === "newest"
  );
}

function money(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("en-PH") : "—";
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hasProof(payment: AdminPaymentRecord): payment is PaymentWithProof {
  return Boolean(payment.proofStorageBucket && payment.proofStoragePath);
}

type PageEntry = number | "ellipsis";

function getPageNumbers(current: number, pageCount: number): PageEntry[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const keep = new Set<number>([1, pageCount, current - 1, current, current + 1]);
  const sorted = [...keep].filter((page) => page >= 1 && page <= pageCount).sort((a, b) => a - b);
  const entries: PageEntry[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) entries.push("ellipsis");
    entries.push(page);
    previous = page;
  }
  return entries;
}

function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <footer className={styles.pagination}>
      <span>{total === 0 ? "No records" : `Showing ${from}–${to} of ${total}`}</span>
      <div className={styles.paginationControls}>
        <label className={styles.pageSizeLabel}>
          Rows per page
          <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.pageButtons}>
          <Button variant="none" type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Previous
          </Button>
          {getPageNumbers(page, pageCount).map((entry, index) =>
            entry === "ellipsis" ? (
              <span key={`ellipsis-${index}`} className={styles.pageEllipsis}>
                …
              </span>
            ) : (
              <Button variant="none"
                key={entry}
                type="button"
                className={entry === page ? styles.pageButtonActive : undefined}
                disabled={entry === page}
                onClick={() => onPageChange(entry)}
              >
                {entry}
              </Button>
            ),
          )}
          <Button variant="none" type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
            Next
          </Button>
        </div>
      </div>
    </footer>
  );
}

export default function AdminPaymentsPage() {
  const { user, profile } = useAuth();

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<AdminPaymentsFilters>(DEFAULT_FILTERS);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsPageSize, setPaymentsPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [paymentsData, setPaymentsData] = useState<AdminPaymentsData | null>(null);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [proofPayment, setProofPayment] = useState<PaymentWithProof | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  // Guards against an older, slower fetch (filter change, retry, or realtime refresh)
  // overwriting the screen after a newer one has already resolved.
  const latestRequestRef = useRef(0);

  function updateFilter<K extends keyof AdminPaymentsFilters>(key: K, value: AdminPaymentsFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPaymentsPage(1);
  }

  function clearFilters() {
    setSearchInput("");
    setDebouncedSearch("");
    setFilters(DEFAULT_FILTERS);
    setPaymentsPage(1);
  }

  const filtersActive = !isDefaultFilters(filters) || Boolean(debouncedSearch);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPaymentsPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  // Shared by the param-driven effect below and by realtime change notifications, so
  // both paths go through the same de-duplicated, stale-response-safe fetch.
  const loadPayments = useCallback(async () => {
    if (!user) return;
    const requestId = ++latestRequestRef.current;
    try {
      const result = await getAdminPayments({
        page: paymentsPage,
        pageSize: paymentsPageSize,
        search: debouncedSearch || undefined,
        filters,
      });
      if (latestRequestRef.current !== requestId) return;
      setPaymentsData(result);
      setPaymentsError(null);
    } catch (loadError) {
      if (latestRequestRef.current !== requestId) return;
      setPaymentsError(loadError instanceof Error ? loadError.message : "Payment activity could not be loaded.");
    }
  }, [user, paymentsPage, paymentsPageSize, debouncedSearch, filters]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPayments();
  }, [loadPayments, retryCount]);

  // Realtime is the source of truth for keeping this page live; the polling/focus
  // fallback inside the hook only covers sleeping tabs and dropped WebSocket connections.
  useBookingRealtime({ tables: PAYMENTS_REALTIME_TABLES, onChange: loadPayments });

  function handleProofReviewed(status: "verified" | "rejected", reason?: string) {
    const reviewedAt = new Date().toISOString();
    const reviewerName = resolveAccountName({ displayName: profile?.displayName, email: profile?.email });

    setPaymentsData((current) => {
      if (!current || !proofPayment) return current;
      let pendingDelta = 0;
      let successfulDelta = 0;
      let revenueDelta = 0;
      let rejectedDelta = 0;
      const payments = current.payments.map((candidate) => {
        if (candidate.id !== proofPayment.id) return candidate;
        if (candidate.status === "submitted" || candidate.status === "under_review") {
          pendingDelta -= 1;
          if (status === "verified") {
            successfulDelta += 1;
            revenueDelta += candidate.amount;
          } else {
            rejectedDelta += 1;
          }
        }
        return {
          ...candidate,
          status,
          reviewNotes: status === "rejected" ? reason : candidate.reviewNotes,
          reviewedAt,
          reviewedByName: reviewerName,
        };
      });
      return {
        ...current,
        payments,
        metrics: {
          ...current.metrics,
          verifiedRevenue: current.metrics.verifiedRevenue + revenueDelta,
          successfulPayments: current.metrics.successfulPayments + successfulDelta,
          pendingCheckouts: current.metrics.pendingCheckouts + pendingDelta,
          statusCounts: {
            ...current.metrics.statusCounts,
            unverified: current.metrics.statusCounts.unverified + pendingDelta,
            verified: current.metrics.statusCounts.verified + successfulDelta,
            rejected: current.metrics.statusCounts.rejected + rejectedDelta,
          },
        },
      };
    });

    // The realtime subscription above will refetch moments after the PATCH lands,
    // replacing this optimistic guess with the authoritative database record.
    setProofPayment((current) => {
      if (!current) return current;
      const updated: PaymentWithProof = {
        ...current,
        status,
        reviewNotes: status === "rejected" ? reason : current.reviewNotes,
        reviewedAt,
        reviewedByName: reviewerName,
      };
      return updated;
    });
  }

  const loading = !paymentsData && !paymentsError;

  return (
    <AdminShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <p>PAYMENT OPERATIONS</p>
            <h1>Payments</h1>
            <span>Review manually submitted GCash payments.</span>
          </div>
        </header>
        {paymentsError ? (
          <div className={styles.error} role="alert">
            {paymentsError}
            <Button variant="none" type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</Button>
          </div>
        ) : null}
        {loading ? (
          <div className={styles.loading}>
            <Spinner size={28} label="Loading payments" />
          </div>
        ) : paymentsData ? (
          <>
            <section className={styles.metrics}>
              <article>
                <span>Recorded Revenue</span>
                <strong>{money(paymentsData.metrics.verifiedRevenue)}</strong>
              </article>
              <article>
                <span>Successful Payments</span>
                <strong>{paymentsData.metrics.successfulPayments}</strong>
              </article>
              <article>
                <span>Pending Checkouts</span>
                <strong>{paymentsData.metrics.pendingCheckouts}</strong>
              </article>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Payment Records</h2>
                  <p>Manual GCash submissions and their review status.</p>
                </div>
              </div>
              <div className={styles.pillTabsRow}>
                <div className={styles.statusTabs} aria-label="Filter by payment status">
                  {STATUS_FILTER_OPTIONS.map((option) => {
                    const isActive = (filters.status ?? "all") === option.value;
                    const count =
                      option.value === "all"
                        ? paymentsData.metrics.statusCounts.all
                        : paymentsData.metrics.statusCounts[option.value];
                    return (
                      <Button variant="none"
                        key={option.value}
                        type="button"
                        className={isActive ? styles.activeTab : ""}
                        aria-pressed={isActive}
                        onClick={() =>
                          updateFilter(
                            "status",
                            option.value === "all" ? undefined : (option.value as AdminPaymentsFilters["status"]),
                          )
                        }
                      >
                        {option.label}
                        <span>{count}</span>
                      </Button>
                    );
                  })}
                </div>
                <div className={styles.statusTabs} aria-label="Filter by payment type">
                  {STAGE_FILTER_OPTIONS.map((option) => {
                    const isActive = (filters.stage ?? "all") === option.value;
                    const count =
                      option.value === "all"
                        ? paymentsData.metrics.stageCounts.all
                        : option.value === "full_payment"
                        ? paymentsData.metrics.stageCounts.fullPayment
                        : option.value === "down_payment"
                        ? paymentsData.metrics.stageCounts.downPayment
                        : option.value === "balance"
                        ? paymentsData.metrics.stageCounts.balance
                        : paymentsData.metrics.stageCounts.other;
                    return (
                      <Button variant="none"
                        key={option.value}
                        type="button"
                        className={isActive ? styles.activeTab : ""}
                        aria-pressed={isActive}
                        onClick={() =>
                          updateFilter(
                            "stage",
                            option.value === "all" ? undefined : (option.value as AdminPaymentsFilters["stage"]),
                          )
                        }
                      >
                        {option.label}
                        <span>{count}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div className={styles.filterBar}>
                <label className={styles.filterField}>
                  <span>Account Type</span>
                  <select
                    value={filters.accountType ?? "all"}
                    onChange={(event) =>
                      updateFilter(
                        "accountType",
                        event.target.value === "all"
                          ? undefined
                          : (event.target.value as AdminPaymentsFilters["accountType"]),
                      )
                    }
                  >
                    {ACCOUNT_TYPE_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.filterField}>
                  <span>Booking Status</span>
                  <select
                    value={filters.bookingStatus ?? "all"}
                    onChange={(event) =>
                      updateFilter(
                        "bookingStatus",
                        event.target.value === "all"
                          ? undefined
                          : (event.target.value as AdminPaymentsFilters["bookingStatus"]),
                      )
                    }
                  >
                    {BOOKING_STATUS_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.filterField}>
                  <span>Proof</span>
                  <select
                    value={filters.proof ?? "all"}
                    onChange={(event) =>
                      updateFilter(
                        "proof",
                        event.target.value === "all" ? undefined : (event.target.value as AdminPaymentsFilters["proof"]),
                      )
                    }
                  >
                    {PROOF_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.filterField}>
                  <span>Sort</span>
                  <select
                    value={filters.sort ?? "newest"}
                    onChange={(event) => updateFilter("sort", event.target.value as AdminPaymentsFilters["sort"])}
                  >
                    {SORT_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="none"
                  type="button"
                  className={styles.clearFiltersButton}
                  disabled={!filtersActive}
                  onClick={clearFilters}
                >
                  Clear Filters
                </Button>
                <input
                  type="search"
                  className={styles.searchInput}
                  placeholder="Search booking, GCash reference, status…"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  aria-label="Search payment records"
                />
              </div>
              {paymentsData.payments.length ? (
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Booking</th>
                        <th>GCash Reference Number</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Payment Type</th>
                        <th>Date</th>
                        <th>Proof</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentsData.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td data-label="Booking">
                            <Link href={`/admin/bookings/${payment.bookingId}`}>
                              {payment.bookingRef}
                            </Link>
                          </td>
                          <td data-label="GCash Reference Number">{payment.externalReference || "—"}</td>
                          <td data-label="Amount">{money(payment.amount)}</td>
                          <td data-label="Status">
                            <StatusBadge
                              label={PAYMENT_STATUS_LABELS[payment.status] ?? formatLabel(payment.status)}
                              tone={PAYMENT_STATUS_TONES[payment.status] ?? "neutral"}
                            />
                          </td>
                          <td data-label="Payment Type">{formatLabel(payment.stage)}</td>
                          <td data-label="Date">{formatDate(payment.createdAt)}</td>
                          <td data-label="Proof">
                            {hasProof(payment) ? (
                              <Button variant="none"
                                type="button"
                                className={styles.viewProofButton}
                                onClick={() => setProofPayment(payment)}
                              >
                                View Proof
                              </Button>
                            ) : (
                              <span className={styles.noProof}>No proof submitted</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.empty}>
                  {filtersActive ? "No payment records match your filters." : "No payment records yet."}
                </p>
              )}
              <PaginationBar
                page={paymentsData.page}
                pageSize={paymentsData.pageSize}
                total={paymentsData.total}
                onPageChange={setPaymentsPage}
                onPageSizeChange={(size) => {
                  setPaymentsPageSize(size);
                  setPaymentsPage(1);
                }}
              />
            </section>
          </>
        ) : null}
      </div>
      {proofPayment ? (
        <PaymentProofModal
          payment={proofPayment}
          onClose={() => setProofPayment(null)}
          onReviewed={handleProofReviewed}
        />
      ) : null}
    </AdminShell>
  );
}
