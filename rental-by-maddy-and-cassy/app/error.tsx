"use client";

import { Button } from "@/components/ui/Button";
import styles from "./routeState.module.css";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className={styles.state}>
      <div role="alert">
        <h1>This page couldn’t load</h1>
        <p>Check your connection and try again. If the problem continues, contact the rental team for help.</p>
      </div>
      <div className={styles.actions}>
        <Button variant="primary" onClick={reset}>Try again</Button>
        <Button variant="secondary" href="/contact">Contact us</Button>
      </div>
    </main>
  );
}
