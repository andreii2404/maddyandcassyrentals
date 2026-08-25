"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import Spinner from "@/components/ui/Spinner";
import ActivityBadge from "@/components/admin/ActivityBadge";
import { useAuth } from "@/hooks/useAuth";
import {
  getAdminAuditLogs,
  type AdminAuditLog,
} from "@/src/services/operationsService";
import { getAllUsers } from "@/src/services/userService";
import type { UserProfile } from "@/src/types/database";
import { resolveAccountName } from "@/src/lib/accountDisplay";
import {
  formatActorRole,
  formatAuditAction,
  formatAuditActor,
  formatAuditDetails,
  formatBookingReference,
  formatWhatHappened,
  getActivityCategory,
  type ActivityCategory,
} from "@/src/lib/auditLogLabels";
import styles from "./audit.module.css";

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

const ACTIVITY_TYPE_OPTIONS: Array<{ value: ActivityCategory | ""; label: string }> = [
  { value: "", label: "All activity types" },
  { value: "booking", label: "Booking" },
  { value: "payment", label: "Payment" },
  { value: "documents", label: "Documents" },
  { value: "account", label: "Account" },
  { value: "catalog", label: "Catalog" },
  { value: "admin", label: "Admin actions" },
];

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

export default function AdminAuditPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AdminAuditLog[] | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const [search, setSearch] = useState("");
  const [activityType, setActivityType] = useState<ActivityCategory | "">("");
  const [performedBy, setPerformedBy] = useState("");
  const [date, setDate] = useState("");
  const [bookingQuery, setBookingQuery] = useState("");
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    if (!user) return;

    getAdminAuditLogs()
      .then((records) => {
        if (active) {
          setLogs(records);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "Audit history could not be loaded.",
          );
        }
      });

    // Non-fatal: used only to resolve real customer/admin names — rows still
    // render with role labels (Administrator/Customer/System) if this fails.
    getAllUsers()
      .then((records) => {
        if (active) setUsers(records);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [user, retryCount]);

  const actorNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of users) {
      const resolved = resolveAccountName(record);
      if (resolved && resolved !== "Guest" && resolved !== "Customer") {
        map.set(record.id, resolved);
      }
    }
    return map;
  }, [users]);

  const performedByOptions = useMemo(() => {
    const names = new Set<string>();
    for (const log of logs ?? []) {
      names.add(formatAuditActor(log, actorNamesById));
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [logs, actorNamesById]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const bookingQueryLower = bookingQuery.trim().toLowerCase();

    return (logs ?? []).filter((log) => {
      if (activityType && getActivityCategory(log.action) !== activityType) return false;
      if (performedBy && formatAuditActor(log, actorNamesById) !== performedBy) return false;

      if (date) {
        const logDate = log.createdAt ? log.createdAt.slice(0, 10) : "";
        if (logDate !== date) return false;
      }

      if (bookingQueryLower) {
        const reference = log.bookingId ? formatBookingReference(log.bookingId).toLowerCase() : "";
        const rawId = (log.bookingId ?? "").toLowerCase();
        if (!reference.includes(bookingQueryLower) && !rawId.includes(bookingQueryLower)) return false;
      }

      if (!query) return true;
      const searchable = [
        formatAuditAction(log.action),
        formatAuditActor(log, actorNamesById),
        formatAuditDetails(log),
        log.bookingId ? formatBookingReference(log.bookingId) : "",
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [logs, search, activityType, performedBy, date, bookingQuery, actorNamesById]);

  // Any change to the active filters can shrink the result set enough that the
  // previously-viewed page no longer exists, so always snap back to page one.
  // (Adjusted during render, not an effect, per https://react.dev/learn/you-might-not-need-an-effect)
  const filterKey = `${search}|${activityType}|${performedBy}|${date}|${bookingQuery}|${pageSize}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const hasActiveFilters = Boolean(search || activityType || performedBy || date || bookingQuery);

  function resetFilters() {
    setSearch("");
    setActivityType("");
    setPerformedBy("");
    setDate("");
    setBookingQuery("");
  }

  function toggleExpanded(id: string) {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <AdminShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <p>SYSTEM ACTIVITY</p>
            <h1>Activity History</h1>
            <span>Review booking, payment, catalog, pricing, and account actions.</span>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search activity"
            aria-label="Search activity"
          />
        </header>

        <section className={styles.panel}>
          <div className={styles.filters}>
            <label>
              <span>Activity type</span>
              <select
                value={activityType}
                onChange={(event) => setActivityType(event.target.value as ActivityCategory | "")}
              >
                {ACTIVITY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Performed by</span>
              <select value={performedBy} onChange={(event) => setPerformedBy(event.target.value)}>
                <option value="">Everyone</option>
                {performedByOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Date</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label>
              <span>Booking</span>
              <input
                value={bookingQuery}
                onChange={(event) => setBookingQuery(event.target.value)}
                placeholder="BK-XXXXXXXXXX"
              />
            </label>
            <label>
              <span>Rows per page</span>
              <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={styles.resetButton}
              onClick={resetFilters}
              disabled={!hasActiveFilters}
            >
              Reset filters
            </button>
          </div>

          {error ? (
            <div className={styles.error} role="alert">
              {error}
              <button type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button>
            </div>
          ) : null}

          {!logs && !error ? (
            <div className={styles.loading}>
              <Spinner size={28} label="Loading audit logs" />
            </div>
          ) : logs ? (
            paginated.length ? (
              <>
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Activity</th>
                        <th>Performed by</th>
                        <th>Details</th>
                        <th>Booking #</th>
                        <th>Date &amp; time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((log) => {
                        const category = getActivityCategory(log.action);
                        const expanded = expandedIds.has(log.id);
                        const actorName = formatAuditActor(log, actorNamesById);
                        const actorRole = formatActorRole(log.actorType);
                        const showActorRole = actorName !== actorRole;

                        return (
                          <Fragment key={log.id}>
                            <tr
                              className={styles.row}
                              tabIndex={0}
                              role="button"
                              aria-expanded={expanded}
                              aria-label={`${expanded ? "Collapse" : "Expand"} details for ${formatAuditAction(log.action)}`}
                              onClick={() => toggleExpanded(log.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  toggleExpanded(log.id);
                                }
                              }}
                            >
                              <td data-label="Activity">
                                <div className={styles.activityCell}>
                                  <span className={expanded ? styles.chevronOpen : styles.chevron} aria-hidden="true" />
                                  <ActivityBadge category={category} />
                                  <strong>{formatAuditAction(log.action)}</strong>
                                </div>
                              </td>
                              <td data-label="Performed by">
                                <strong>{actorName}</strong>
                                {showActorRole ? <small>{actorRole}</small> : null}
                              </td>
                              <td data-label="Details">{formatAuditDetails(log)}</td>
                              <td data-label="Booking #">
                                {log.bookingId ? (
                                  <Link
                                    href={`/admin/bookings/${log.bookingId}`}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    {formatBookingReference(log.bookingId)}
                                  </Link>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td data-label="Date & time">{formatTimestamp(log.createdAt)}</td>
                            </tr>
                            {expanded ? (
                              <tr className={styles.detailRow}>
                                <td colSpan={5}>
                                  <div className={styles.detailPanel}>
                                    <span className={styles.detailLabel}>What happened</span>
                                    <p className={styles.detailText}>
                                      {formatWhatHappened(log, actorName)}
                                    </p>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <footer className={styles.pagination}>
                  <span>
                    Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of{" "}
                    {filtered.length}
                  </span>
                  <div>
                    <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                      Previous
                    </button>
                    <strong>
                      Page {currentPage} of {pageCount}
                    </strong>
                    <button
                      type="button"
                      disabled={currentPage === pageCount}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      Next
                    </button>
                  </div>
                </footer>
              </>
            ) : (
              <p className={styles.empty}>No audit activity matches these filters.</p>
            )
          ) : null}
        </section>
      </div>
    </AdminShell>
  );
}
