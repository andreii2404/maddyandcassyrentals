"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/ToastProvider";
import { isPushSupported, subscribeToPush } from "@/src/lib/webpush/client";
import styles from "./PushNotificationButton.module.css";

export default function PushNotificationButton() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [enabling, setEnabling] = useState(false);
  // Browser permission alone does not mean this account's subscription is registered.
  const [enabled, setEnabled] = useState(false);

  async function enable() {
    if (!user || enabling || enabled) return;
    setEnabling(true);
    try {
      if (!(await isPushSupported())) {
        throw new Error("This browser does not support push notifications.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted.");

      const subscription = await subscribeToPush();
      const json = subscription.toJSON();
      const response = await fetch("/api/push/register", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
        }),
      });
      if (!response.ok) throw new Error("The push subscription could not be registered.");
      setEnabled(true);
      showToast("Push notifications are enabled on this device.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Push notifications could not be enabled.", "error");
    } finally {
      setEnabling(false);
    }
  }

  return (
    <div className={styles.panel}>
      <div>
        <strong>Booking push notifications</strong>
        <span>Receive payment, review, and rental-status updates on this device.</span>
      </div>
      <Button variant="secondary" type="button" onClick={enable} disabled={enabled || !user} loading={enabling} loadingText="Enabling...">
        {enabled ? "Enabled" : "Enable Notifications"}
      </Button>
    </div>
  );
}
