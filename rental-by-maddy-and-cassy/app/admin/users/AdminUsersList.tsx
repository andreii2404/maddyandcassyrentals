"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAllAdmins } from "@/src/services/adminService";
import { getAllUsers } from "@/src/services/userService";
import type { Admin, UserProfile } from "@/src/types/database";
import { resolveAccountType, resolveCustomerName } from "@/src/lib/accountDisplay";
import type { AccountType } from "@/src/lib/accountDisplay";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "@/components/status-badge/StatusBadge";
import type { StatusTone } from "@/components/status-badge/StatusBadge";
import styles from "./users.module.css";

const PAGE_SIZE = 10;

interface AccountsData {
  users: UserProfile[];
  admins: Admin[];
}

function formatDate(value: UserProfile["createdAt"]): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatStatusLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Badge colour for each account type, matching the Status column's tag style. */
const ACCOUNT_TYPE_TONE: Record<AccountType, StatusTone> = {
  Admin: "yellow",
  Account: "green",
  Guest: "neutral",
};

export default function AdminUsersList() {
  const [data, setData] = useState<AccountsData | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const loadAccounts = useCallback(() => {
    setError(null);
    let active = true;

    Promise.all([getAllUsers(), getAllAdmins()])
      .then(([users, admins]) => {
        if (active) setData({ users, admins });
      })
      .catch(() => {
        if (active) setError("User accounts could not be loaded. Please refresh and try again.");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let stopLoading: (() => void) | undefined;
    const timeoutId = window.setTimeout(() => {
      stopLoading = loadAccounts();
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
      stopLoading?.();
    };
  }, [loadAccounts, retryCount]);

  const adminIds = useMemo(
    () => new Set((data?.admins ?? []).map((admin) => admin.userId)),
    [data]
  );

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const users = data?.users ?? [];
    if (!query) return users;

    return users.filter(
      (account) =>
        resolveCustomerName(account).toLowerCase().includes(query) ||
        account.displayName?.toLowerCase().includes(query) ||
        account.email?.toLowerCase().includes(query) ||
        account.phoneNumber?.toLowerCase().includes(query)
    );
  }, [data, search]);

  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleUsers = filteredUsers.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ACCOUNT MANAGEMENT</p>
          <h1>User Accounts</h1>
          <p>View customer and administrator account records stored in Supabase.</p>
        </div>
        <span className={styles.count}>{data?.users.length ?? 0} accounts</span>
      </header>

      <section className={styles.panel} aria-labelledby="accounts-heading">
        <div className={styles.toolbar}>
          <div>
            <h2 id="accounts-heading">All Accounts</h2>
            <p>Select an account to view its profile and rental history.</p>
          </div>
          <label className={styles.searchLabel}>
            <span className={styles.visuallyHidden}>Search user accounts</span>
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search name, email, or phone"
              className={styles.search}
            />
          </label>
        </div>

        {error ? (
          <div className={styles.error} role="alert">
            {error}
            <button type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button>
          </div>
        ) : null}

        {!data && !error ? (
          <div className={styles.loading}>
            <Spinner size={26} label="Loading user accounts" />
          </div>
        ) : data ? (
          filteredUsers.length ? (
            <>
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Account Type</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Status</th>
                    <th>Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map((account) => {
                    const name = resolveCustomerName(account);
                    const hasName = name !== "Not provided";
                    const accountType = resolveAccountType(account, adminIds.has(account.id));
                    return (
                    <tr key={account.id}>
                      <td data-label="Name">
                        <Link href={`/admin/users/${account.id}`} className={styles.accountLink}>
                          <span className={styles.avatar} aria-hidden="true">
                            {hasName ? name.charAt(0).toUpperCase() : "?"}
                          </span>
                          <span>
                            <strong>{name}</strong>
                            <small>View account</small>
                          </span>
                        </Link>
                      </td>
                      <td data-label="Account Type">
                        <StatusBadge label={accountType} tone={ACCOUNT_TYPE_TONE[accountType]} />
                      </td>
                      <td data-label="Email">{account.email || "Not provided"}</td>
                      <td data-label="Phone">{account.phoneNumber || "Not provided"}</td>
                      <td data-label="Status">
                        <StatusBadge
                          label={formatStatusLabel(account.accountStatus)}
                          tone={account.accountStatus === "active" ? "green" : "red"}
                        />
                      </td>
                      <td data-label="Registered">{formatDate(account.createdAt)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredUsers.length > PAGE_SIZE ? (
              <nav className={styles.pagination} aria-label="User accounts pagination">
                <span>
                  Showing {(currentPage - 1) * PAGE_SIZE + 1}&ndash;{Math.min(currentPage * PAGE_SIZE, filteredUsers.length)} of {filteredUsers.length}
                </span>
                <div>
                  <button
                    type="button"
                    disabled={currentPage === 1}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous
                  </button>
                  {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                    <button
                      key={pageNumber}
                      type="button"
                      className={pageNumber === currentPage ? styles.pageActive : undefined}
                      aria-current={pageNumber === currentPage ? "page" : undefined}
                      onClick={() => setPage(pageNumber)}
                    >
                      {pageNumber}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={currentPage === pageCount}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next
                  </button>
                </div>
              </nav>
            ) : null}
            </>
          ) : (
            <p className={styles.empty}>
              {data.users.length === 0
                ? "No accounts have been registered yet."
                : "No accounts match your search."}
            </p>
          )
        ) : null}
      </section>
    </div>
  );
}
