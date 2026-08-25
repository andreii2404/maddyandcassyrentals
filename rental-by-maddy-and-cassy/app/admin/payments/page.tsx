"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import Spinner from "@/components/ui/Spinner";
import StatusBadge, { type StatusTone } from "@/components/status-badge/StatusBadge";
import PaymentProofModal, { type PaymentWithProof } from "@/components/admin/PaymentProofModal";
import { useAuth } from "@/hooks/useAuth";
import { getAdminPayments, type AdminPaymentsData } from "@/src/services/operationsService";
import type { AdminPaymentRecord } from "@/src/types/payment";
import styles from "../operations.module.css";

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

const PAYMENT_STATUS_TONES: Record<AdminPaymentRecord["status"], StatusTone> = {
  submitted: "yellow",
  under_review: "yellow",
  verified: "green",
  rejected: "red",
  void: "neutral",
};

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
          <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Previous
          </button>
          {getPageNumbers(page, pageCount).map((entry, index) =>
            entry === "ellipsis" ? (
              <span key={`ellipsis-${index}`} className={styles.pageEllipsis}>
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                className={entry === page ? styles.pageButtonActive : undefined}
                disabled={entry === page}
                onClick={() => onPageChange(entry)}
              >
                {entry}
              </button>
            ),
          )}
          <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
            Next
          </button>
        </div>
      </div>
    </footer>
  );
}

export default function AdminPaymentsPage() {
  const { user } = useAuth();

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsPageSize, setPaymentsPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [paymentsData, setPaymentsData] = useState<AdminPaymentsData | null>(null);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [proofPayment, setProofPayment] = useState<PaymentWithProof | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPaymentsPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    if (!user) return;

    setRefreshing(true);
    getAdminPayments({ page: paymentsPage, pageSize: paymentsPageSize, search: debouncedSearch || undefined })
      .then((result) => {
        if (active) {
          setPaymentsData(result);
          setPaymentsError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setPaymentsError(
            loadError instanceof Error ? loadError.message : "Payment activity could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });

    return () => {
      active = false;
    };
  }, [user, paymentsPage, paymentsPageSize, debouncedSearch, retryCount]);

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
            <button type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button>
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
                {refreshing && paymentsData ? <span className={styles.refreshNote} role="status">Updating…</span> : null}
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
                              label={formatLabel(payment.status)}
                              tone={PAYMENT_STATUS_TONES[payment.status] ?? "neutral"}
                            />
                          </td>
                          <td data-label="Payment Type">{formatLabel(payment.stage)}</td>
                          <td data-label="Date">{formatDate(payment.createdAt)}</td>
                          <td data-label="Proof">
                            {hasProof(payment) ? (
                              <button
                                type="button"
                                className={styles.viewProofButton}
                                onClick={() => setProofPayment(payment)}
                              >
                                View Proof
                              </button>
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
                  {debouncedSearch ? "No payment records match your search." : "No payment records yet."}
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
        <PaymentProofModal payment={proofPayment} onClose={() => setProofPayment(null)} />
      ) : null}
    </AdminShell>
  );
}
