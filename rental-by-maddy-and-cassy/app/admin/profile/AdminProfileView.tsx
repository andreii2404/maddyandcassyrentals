"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getAdminProfile } from "@/src/services/adminService";
import type { Admin } from "@/src/types/admin";
import Spinner from "@/components/ui/Spinner";
import styles from "./profile.module.css";

function formatDate(value: string | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminProfileView() {
  const { user, profile } = useAuth();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;

    getAdminProfile(user.id)
      .then((record) => {
        if (!active) return;
        setAdmin(record);
        setLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setError("The administrator profile could not be loaded.");
        setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [user]);

  if (!loaded) {
    return (
      <div className={styles.loading}>
        <Spinner size={28} label="Loading administrator profile" />
      </div>
    );
  }

  if (error || !admin) {
    return <div className={styles.error}>{error ?? "Administrator record not found."}</div>;
  }

  const displayName = profile?.displayName ?? (user?.user_metadata?.display_name as string | undefined) ?? "Administrator";
  const email = profile?.email ?? user?.email ?? "Not available";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>ADMINISTRATOR ACCOUNT</p>
        <h1>Admin Profile</h1>
        <p>Your administrator identity and access details.</p>
      </header>

      <section className={styles.card} aria-labelledby="admin-name">
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">
            {displayName.charAt(0).toUpperCase()}
          </span>
          <div className={styles.identityText}>
            <h2 id="admin-name">{displayName}</h2>
            <p>{email}</p>
          </div>
          <span className={`${styles.status} ${admin.isActive ? styles.active : styles.inactive}`}>
            {admin.isActive ? "Active Administrator" : "Inactive Administrator"}
          </span>
        </div>

        <dl className={styles.details}>
          <div>
            <dt>Account Type</dt>
            <dd>Administrator</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{admin.isActive ? "Active" : "Inactive"}</dd>
          </div>
          <div>
            <dt>Access Created</dt>
            <dd>{formatDate(admin.createdAt)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
