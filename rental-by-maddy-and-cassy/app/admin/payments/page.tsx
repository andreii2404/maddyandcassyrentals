"use client";

import { Button } from "@/components/ui/Button";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
    !filters.dateFrom &&
    !filters.dateTo &&
    (filters.sort ?? "newest") === "newest"
  );
}

/** How many filter controls are currently narrowing the list (the date range counts once). */
function countActiveFilters(filters: AdminPaymentsFilters, search: string): number {
  return [
    filters.status,
    filters.stage,
    filters.accountType,
    filters.bookingStatus,
    filters.proof,
    filters.dateFrom || filters.dateTo,
    search,
    (filters.sort ?? "newest") !== "newest" ? filters.sort : undefined,
  ].filter(Boolean).length;
}

function statusCount(metrics: AdminPaymentsData["metrics"], value: (typeof STATUS_FILTER_OPTIONS)[number]["value"]): number {
  return value === "all" ? metrics.statusCounts.all : metrics.statusCounts[value];
}

function stageCount(metrics: AdminPaymentsData["metrics"], value: (typeof STAGE_FILTER_OPTIONS)[number]["value"]): number {
  return value === "all"
    ? metrics.stageCounts.all
    : value === "full_payment"
    ? metrics.stageCounts.fullPayment
    : value === "down_payment"
    ? metrics.stageCounts.downPayment
    : value === "balance"
    ? metrics.stageCounts.balance
    : metrics.stageCounts.other;
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

  // `searchInput` and `draftFilters` are what the filter controls edit; `appliedSearch` and
  // `filters` are what the table is actually filtered by. Apply Filters copies draft -> applied.
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [draftFilters, setDraftFilters] = useState<AdminPaymentsFilters>(DEFAULT_FILTERS);
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

  function updateDraftFilter<K extends keyof AdminPaymentsFilters>(key: K, value: AdminPaymentsFilters[K]) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters(draftFilters);
    setAppliedSearch(searchInput.trim());
    setPaymentsPage(1);
  }

  function clearFilters() {
    setSearchInput("");
    setAppliedSearch("");
    setDraftFilters(DEFAULT_FILTERS);
    setFilters(DEFAULT_FILTERS);
    setPaymentsPage(1);
  }

  const filtersActive = !isDefaultFilters(filters) || Boolean(appliedSearch);
  const activeFilterCount = countActiveFilters(filters, appliedSearch);
  const canClearFilters = filtersActive || !isDefaultFilters(draftFilters) || Boolean(searchInput.trim());

  // Shared by the param-driven effect below and by realtime change notifications, so
  // both paths go through the same de-duplicated, stale-response-safe fetch.
  const loadPayments = useCallback(async () => {
    if (!user) return;
    const requestId = ++latestRequestRef.current;
    try {
      const result = await getAdminPayments({
        page: paymentsPage,
        pageSize: paymentsPageSize,
        search: appliedSearch || undefined,
        filters,
      });
      if (latestRequestRef.current !== requestId) return;
      setPaymentsData(result);
      setPaymentsError(null);
    } catch (loadError) {
      if (latestRequestRef.current !== requestId) return;
      setPaymentsError(loadError instanceof Error ? loadError.message : "Payment activity could not be loaded.");
    }
  }, [user, paymentsPage, paymentsPageSize, appliedSearch, filters]);

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
              <form className={styles.filterPanel} onSubmit={applyFilters} aria-label="Filter payment records">
                <div className={styles.filterPanelHeader}>
                  <h3>Filters</h3>
                  {activeFilterCount ? (
                    <span className={styles.filterCountBadge}>{activeFilterCount} applied</span>
                  ) : null}
                </div>
                <div className={styles.filterGrid}>
                  <label className={styles.filterControl}>
                    <span>Payment Status</span>
                    <select
                      value={draftFilters.status ?? "all"}
                      onChange={(event) =>
                        updateDraftFilter(
                          "status",
                          event.target.value === "all" ? undefined : (event.target.value as AdminPaymentsFilters["status"]),
                        )
                      }
                    >
                      {STATUS_FILTER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} ({statusCount(paymentsData.metrics, option.value)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.filterControl}>
                    <span>Payment Type</span>
                    <select
                      value={draftFilters.stage ?? "all"}
                      onChange={(event) =>
                        updateDraftFilter(
                          "stage",
                          event.target.value === "all" ? undefined : (event.target.value as AdminPaymentsFilters["stage"]),
                        )
                      }
                    >
                      {STAGE_FILTER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} ({stageCount(paymentsData.metrics, option.value)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.filterControl}>
                    <span>Account Type</span>
                    <select
                      value={draftFilters.accountType ?? "all"}
                      onChange={(event) =>
                        updateDraftFilter(
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
                  <label className={styles.filterControl}>
                    <span>Booking Status</span>
                    <select
                      value={draftFilters.bookingStatus ?? "all"}
                      onChange={(event) =>
                        updateDraftFilter(
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
                  <label className={styles.filterControl}>
                    <span>Proof</span>
                    <select
                      value={draftFilters.proof ?? "all"}
                      onChange={(event) =>
                        updateDraftFilter(
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
                  <label className={styles.filterControl}>
                    <span>Sort</span>
                    <select
                      value={draftFilters.sort ?? "newest"}
                      onChange={(event) => updateDraftFilter("sort", event.target.value as AdminPaymentsFilters["sort"])}
                    >
                      {SORT_FILTER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className={`${styles.filterControl} ${styles.dateControl}`} role="group" aria-labelledby="payments-date-filter-label">
                    <span id="payments-date-filter-label">Date</span>
                    <div className={styles.dateRange}>
                      <input
                        type="date"
                        aria-label="From date"
                        value={draftFilters.dateFrom ?? ""}
                        max={draftFilters.dateTo || undefined}
                        onChange={(event) => updateDraftFilter("dateFrom", event.target.value || undefined)}
                      />
                      <span aria-hidden="true">to</span>
                      <input
                        type="date"
                        aria-label="To date"
                        value={draftFilters.dateTo ?? ""}
                        min={draftFilters.dateFrom || undefined}
                        onChange={(event) => updateDraftFilter("dateTo", event.target.value || undefined)}
                      />
                    </div>
                  </div>
                  <label className={`${styles.filterControl} ${styles.searchControl}`}>
                    <span>Search</span>
                    <input
                      type="search"
                      placeholder="Booking, GCash reference or status"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                    />
                  </label>
                </div>
                <div className={styles.filterActions}>
                  <Button
                    variant="none"
                    type="button"
                    className={styles.clearFiltersButton}
                    disabled={!canClearFilters}
                    onClick={clearFilters}
                  >
                    Clear Filters
                  </Button>
                  <Button variant="none" type="submit" className={styles.applyFiltersButton}>
                    Apply Filters
                  </Button>
                </div>
              </form>
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
