"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import MessagingWorkspace from "@/components/messaging/MessagingWorkspace";
import { startGuestCheckout } from "@/src/services/authService";
import styles from "./messages.module.css";

export default function MessagesPageClient() {
  const { user, isAdmin, loading } = useAuth();
  const [startingGuest, setStartingGuest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startGuestChat() {
    if (startingGuest) return;
    setStartingGuest(true);
    setError(null);
    try {
      await startGuestCheckout();
    } catch (guestError) {
      setError(guestError instanceof Error ? guestError.message : "Guest chat could not be started.");
      setStartingGuest(false);
    }
  }

  if (loading) {
    return <main className={styles.page}><div className={styles.loading}>Preparing messages…</div></main>;
  }

  if (isAdmin) {
    return (
      <main className={styles.page}>
        <div className={styles.welcomeCard}>
          <span>Administrator account</span>
          <h1>Customer messages are in the admin inbox.</h1>
          <p>Open the shared inbox to view every registered and guest conversation.</p>
          <Link href="/admin/messages" className={styles.primaryAction}>Open admin messages</Link>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className={styles.page}>
        <div className={styles.welcomeCard}>
          <span>Message Maddy &amp; Cassy</span>
          <h1>How can we help with your rental?</h1>
          <p>Start a guest chat with no account, or sign in to keep your conversation history available after login.</p>
          {error ? <div className={styles.error} role="alert">{error}</div> : null}
          <div className={styles.actions}>
            <button type="button" className={styles.primaryAction} onClick={() => void startGuestChat()} disabled={startingGuest}>
              {startingGuest ? "Starting chat…" : "Continue as guest"}
            </button>
            <Link href="/sign-in" className={styles.secondaryAction}>Sign in</Link>
          </div>
          <small>Guest chats stay on this browser. No permanent account is created.</small>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.workspacePage}>
      <MessagingWorkspace mode="customer" isGuest={user.is_anonymous === true} />
    </main>
  );
}
