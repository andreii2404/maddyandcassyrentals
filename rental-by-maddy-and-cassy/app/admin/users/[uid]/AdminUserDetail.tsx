"use client";

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
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "@/components/status-badge/StatusBadge";
import styles from "./userDetail.module.css";
import AccountManagementPanel from "@/components/admin/AccountManagementPanel";

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
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [deleting, setDeleting] = useState(false);

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
    if (!user || confirmationText !== "DELETE") return;

    setDeleting(true);
    try {
      await deleteCustomerAccountAsAdmin(uid);
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

  return (
    <div className={styles.page}>
      <Link href="/admin/users" className={styles.backLink}>
        ← Back to User Accounts
      </Link>

      <header className={styles.profileHeader}>
        <span className={styles.avatar} aria-hidden="true">
          {account.displayName?.charAt(0).toUpperCase() || "C"}
        </span>
        <div>
          <p className={styles.eyebrow}>
            {isAdministrator ? "ADMINISTRATOR ACCOUNT" : "CUSTOMER ACCOUNT"}
          </p>
          <h1>{account.displayName || "Unnamed account"}</h1>
          <p>{account.email}</p>
        </div>
        <span className={`${styles.status} ${styles[account.accountStatus]}`}>
          {account.accountStatus}
        </span>
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
          <div>
            <dt>User ID</dt>
            <dd className={styles.uid}>{account.id}</dd>
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
                  <tr key={booking.id}>
                    <td>{booking.bookingRef}</td>
                    <td>{bookingHeadline(booking.items)}</td>
                    <td>
                      {formatDate(booking.startDate)} – {formatDate(booking.endDate)}
                    </td>
                    <td className={styles.capitalize}>{booking.fulfillmentMethod}</td>
                    <td>
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

      <AccountManagementPanel
        account={account}
        isAdministrator={isAdministrator}
      />

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

        {!isAdministrator && !confirmationOpen ? (
          <button
            type="button"
            className={styles.deleteButton}
            onClick={() => setConfirmationOpen(true)}
          >
            Delete Account
          </button>
        ) : null}

        {!isAdministrator && confirmationOpen ? (
          <div className={styles.confirmation} role="alertdialog" aria-modal="true">
            <p>
              This action cannot be undone. Type <strong>DELETE</strong> to confirm.
            </p>
            <label htmlFor="delete-account-confirmation">Confirmation</label>
            <input
              id="delete-account-confirmation"
              value={confirmationText}
              onChange={(event) => setConfirmationText(event.target.value)}
              autoComplete="off"
              disabled={deleting}
            />
            <div className={styles.confirmationActions}>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={() => {
                  setConfirmationOpen(false);
                  setConfirmationText("");
                }}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.confirmDeleteButton}
                onClick={handleDeleteAccount}
                disabled={confirmationText !== "DELETE" || deleting}
              >
                {deleting ? "Deleting..." : "Permanently Delete"}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
