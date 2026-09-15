"use client";

import { Button } from "@/components/ui/Button";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getAdminProfile } from "@/src/services/adminService";
import { getBookingsForUser } from "@/src/services/bookingService";
import {
  deleteCustomerAccountAsAdmin,
  getUserProfile,
} from "@/src/services/userService";
import { createClient } from "@/src/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/ToastProvider";
import type { Booking, UserProfile } from "@/src/types/database";
import { bookingHeadline } from "@/src/lib/bookingDisplay";
import { resolveAccountName } from "@/src/lib/accountDisplay";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "@/components/status-badge/StatusBadge";
import styles from "./userDetail.module.css";

const DELETED_BY_OPTIONS = ["Maddy", "Cassy"] as const;
type DeletedBy = (typeof DELETED_BY_OPTIONS)[number];

interface UserDetailData {
  account: UserProfile;
  bookings: Booking[];
  isAdministrator: boolean;
}

function formatDate(value: string | undefined | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminUserDetail({ uid }: { uid: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [data, setData] = useState<UserDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteStep, setDeleteStep] = useState<"closed" | "fields" | "confirm">("closed");
  const [deletedBy, setDeletedBy] = useState<DeletedBy | "">("");
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  function resetDeleteFlow() {
    setDeleteStep("closed");
    setDeletedBy("");
    setReason("");
  }

  useEffect(() => {
    let active = true;

    const supabase = createClient();
    Promise.all([getUserProfile(uid), getBookingsForUser(supabase, uid), getAdminProfile(uid)])
      .then(([account, bookings, administrator]) => {
        if (!active) return;
        if (!account) {
          setError("This user account does not exist.");
          return;
        }
        setData({ account, bookings, isAdministrator: administrator !== null });
      })
      .catch(() => {
        if (active) setError("This account could not be loaded. Please try again.");
      });

    return () => {
      active = false;
    };
  }, [uid]);

  async function handleDeleteAccount() {
    if (!user || !deletedBy || !reason.trim()) return;

    setDeleting(true);
    try {
      await deleteCustomerAccountAsAdmin(uid, { deletedBy, reason: reason.trim() });
      showToast("The customer account has been deleted.", "success");
      router.replace("/admin/users");
      router.refresh();
    } catch (deleteError) {
      const message =
        deleteError instanceof Error
          ? deleteError.message
          : "The customer account could not be deleted.";
      showToast(message, "error");
      setDeleting(false);
    }
  }

  if (error) {
    return (
      <div className={styles.page}>
        <Link href="/admin/users" className={styles.backLink}>
          ← Back to User Accounts
        </Link>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.loading}>
        <Spinner size={28} label="Loading user account" />
      </div>
    );
  }

  const { account, bookings, isAdministrator } = data;
  const accountName = resolveAccountName(account);

  return (
    <div className={styles.page}>
      <Link href="/admin/users" className={styles.backLink}>
        ← Back to User Accounts
      </Link>

      <header className={styles.profileHeader}>
        <span className={styles.avatar} aria-hidden="true">
          {accountName.charAt(0).toUpperCase()}
        </span>
        <div>
          <p className={styles.eyebrow}>
            {isAdministrator ? "ADMINISTRATOR ACCOUNT" : "CUSTOMER ACCOUNT"}
          </p>
          <h1>{accountName}</h1>
          <p>{account.email || "No email on file"}</p>
        </div>
        <StatusBadge
          label={account.accountStatus.charAt(0).toUpperCase() + account.accountStatus.slice(1)}
          tone={account.accountStatus === "active" ? "green" : "red"}
        />
      </header>

      <section className={styles.details} aria-labelledby="customer-details-heading">
        <h2 id="customer-details-heading">Customer Details</h2>
        <dl>
          <div>
            <dt>Phone</dt>
            <dd>{account.phoneNumber || "Not provided"}</dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>{account.fullAddress || "Not provided"}</dd>
          </div>
          <div>
            <dt>Facebook</dt>
            <dd>
              {account.facebookLink ? (
                <a
                  href={account.facebookLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.externalLink}
                >
                  Open Facebook profile
                </a>
              ) : (
                "Not provided"
              )}
            </dd>
          </div>
          <div>
            <dt>Instagram</dt>
            <dd>
              {account.instagramLink ? (
                <a
                  href={account.instagramLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.externalLink}
                >
                  Open Instagram profile
                </a>
              ) : (
                "Not provided"
              )}
            </dd>
          </div>
          <div>
            <dt>Registered</dt>
            <dd>{formatDate(account.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.bookings} aria-labelledby="rental-history-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="rental-history-heading">Booking &amp; Rental History</h2>
            <p>{bookings.length} booking record{bookings.length === 1 ? "" : "s"}</p>
          </div>
        </div>

        {bookings.length ? (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Product</th>
                  <th>Dates</th>
                  <th>Fulfillment</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => (
                  <tr
                    key={booking.id}
                    className={styles.historyRow}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open booking ${booking.bookingRef}`}
                    onClick={() => router.push(`/admin/bookings/${booking.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push(`/admin/bookings/${booking.id}`);
                      }
                    }}
                  >
                    <td data-label="Booking">
                      <Link
                        href={`/admin/bookings/${booking.id}`}
                        className={styles.bookingLink}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {booking.bookingRef}
                      </Link>
                    </td>
                    <td data-label="Product">{bookingHeadline(booking.items)}</td>
                    <td data-label="Dates">
                      {formatDate(booking.startDate)} – {formatDate(booking.endDate)}
                    </td>
                    <td data-label="Fulfillment" className={styles.capitalize}>{booking.fulfillmentMethod}</td>
                    <td data-label="Status">
                      <StatusBadge status={booking.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>This customer has no booking history yet.</p>
        )}
      </section>

      <section
        className={`${styles.dangerZone} ${isAdministrator ? styles.protectedZone : ""}`}
        aria-labelledby="account-removal-heading"
      >
        <div>
          <h2 id="account-removal-heading">
            {isAdministrator ? "Protected Administrator Account" : "Delete Customer Account"}
          </h2>
          <p>
            {isAdministrator
              ? "Administrator accounts cannot be deleted from customer account management."
              : "Permanently removes this customer's Supabase Auth login, profile, and notifications. Existing booking and rental history is retained for business records."}
          </p>
        </div>

        {!isAdministrator && deleteStep === "closed" ? (
          <Button variant="none"
            type="button"
            className={styles.deleteButton}
            onClick={() => setDeleteStep("fields")}
          >
            Delete Account
          </Button>
        ) : null}

        {!isAdministrator && deleteStep === "fields" ? (
          <div className={styles.confirmation} role="alertdialog" aria-modal="true">
            <p>This action cannot be undone. Both fields are required to continue.</p>
            <label htmlFor="delete-account-deleted-by">Deleted by</label>
            <select
              id="delete-account-deleted-by"
              value={deletedBy}
              onChange={(event) => setDeletedBy(event.target.value as DeletedBy)}
              disabled={deleting}
            >
              <option value="">Select who is deleting this account</option>
              {DELETED_BY_OPTIONS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <label htmlFor="delete-account-reason">Reason for deletion</label>
            <textarea
              id="delete-account-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              disabled={deleting}
            />
            <div className={styles.confirmationActions}>
              <Button variant="none"
                type="button"
                className={styles.cancelButton}
                onClick={resetDeleteFlow}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button variant="none"
                type="button"
                className={styles.confirmDeleteButton}
                onClick={() => setDeleteStep("confirm")}
                disabled={!deletedBy || !reason.trim() || deleting}
              >
                Continue
              </Button>
            </div>
          </div>
        ) : null}

        {!isAdministrator && deleteStep === "confirm" ? (
          <div className={styles.confirmation} role="alertdialog" aria-modal="true">
            <p>Are you sure you want to delete this customer account?</p>
            <div className={styles.confirmationActions}>
              <Button variant="none"
                type="button"
                className={styles.cancelButton}
                onClick={() => setDeleteStep("fields")}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button variant="none"
                type="button"
                className={styles.confirmDeleteButton}
                onClick={handleDeleteAccount}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Yes, Permanently Delete"}
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
