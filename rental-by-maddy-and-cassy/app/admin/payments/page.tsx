"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import Spinner from "@/components/ui/Spinner";
import { useAuth } from "@/hooks/useAuth";
import {
  getAdminPayments,
  getAdminPaymentEvents,
  type AdminPaymentsData,
  type AdminPaymentEventsData,
} from "@/src/services/operationsService";
import styles from "../operations.module.css";

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

function money(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("en-PH") : "—";
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

  const [eventsPage, setEventsPage] = useState(1);
  const [eventsPageSize, setEventsPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [eventsData, setEventsData] = useState<AdminPaymentEventsData | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);

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
      });

    return () => {
      active = false;
    };
  }, [user, paymentsPage, paymentsPageSize, debouncedSearch]);

  useEffect(() => {
    let active = true;
    if (!user) return;

    getAdminPaymentEvents({ page: eventsPage, pageSize: eventsPageSize })
      .then((result) => {
        if (active) {
          setEventsData(result);
          setEventsError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setEventsError(
            loadError instanceof Error ? loadError.message : "Webhook activity could not be loaded.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [user, eventsPage, eventsPageSize]);

  const loading = !paymentsData && !paymentsError;

  return (
    <AdminShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <p>PAYMENT OPERATIONS</p>
            <h1>Payments &amp; Webhooks</h1>
            <span>
              Review manually submitted GCash payments. Historic PayMongo transactions remain visible below.
            </span>
          </div>
        </header>
        {paymentsError ? <div className={styles.error}>{paymentsError}</div> : null}
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
              <article>
                <span>Webhook Events</span>
                <strong>{eventsData?.total ?? 0}</strong>
              </article>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Payment Records</h2>
                  <p>Customer checkout and provider references.</p>
                </div>
                <input
                  type="search"
                  className={styles.searchInput}
                  placeholder="Search booking, reference, status, method…"
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
                        <th>Reference</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Mode</th>
                        <th>Method</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentsData.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td>
                            <Link href={`/admin/bookings/${payment.bookingId}`}>
                              {payment.bookingId.slice(0, 8)}
                            </Link>
                          </td>
                          <td>
                            {payment.paymongoPaymentId || payment.externalReference || "—"}
                          </td>
                          <td>{money(payment.amount)}</td>
                          <td>
                            <span
                              className={`${styles.pill} ${styles[payment.status] ?? ""}`}
                            >
                              {payment.status}
                            </span>
                          </td>
                          <td>{payment.proofDocumentId ? "Manual" : "PayMongo"}</td>
                          <td>{payment.paymentMethod || "—"}</td>
                          <td>{formatDate(payment.createdAt)}</td>
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

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Legacy Webhook Log</h2>
                  <p>Historic signed PayMongo events from before the switch to manual GCash payments.</p>
                </div>
              </div>
              {eventsError ? <div className={styles.error}>{eventsError}</div> : null}
              {eventsData?.events.length ? (
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Type</th>
                        <th>Signature</th>
                        <th>Status</th>
                        <th>Payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eventsData.events.map((event) => (
                        <tr key={event.id}>
                          <td>{event.providerEventId}</td>
                          <td>{event.eventType}</td>
                          <td>{event.signatureValid ? "Verified" : "Unverified"}</td>
                          <td>
                            <span
                              className={`${styles.pill} ${styles[event.processingStatus] ?? ""}`}
                            >
                              {event.processingStatus}
                            </span>
                          </td>
                          <td>
                            {event.paymentSubmissionId ? (
                              <span>{event.paymentSubmissionId.slice(0, 8)}</span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : eventsData ? (
                <p className={styles.empty}>No webhook events on record.</p>
              ) : null}
              {eventsData ? (
                <PaginationBar
                  page={eventsData.page}
                  pageSize={eventsData.pageSize}
                  total={eventsData.total}
                  onPageChange={setEventsPage}
                  onPageSizeChange={(size) => {
                    setEventsPageSize(size);
                    setEventsPage(1);
                  }}
                />
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
