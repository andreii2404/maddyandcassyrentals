"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";
import { computeAmountOwed, getCompletionBlockers } from "@/src/lib/rentalFulfillment";
import { completeRental } from "@/src/services/fulfillmentService";
import type { FulfillmentPanelContext } from "@/src/types/fulfillment";
import ItemConditionPanel from "./ItemConditionPanel";
import PickupPanel from "./PickupPanel";
import ReturnPanel from "./ReturnPanel";
import ChargesPaymentsPanel from "./ChargesPaymentsPanel";
import styles from "./fulfillment.module.css";

type TabId = "pickup" | "return" | "condition" | "charges" | "complete";

const TABS: { id: TabId; label: string }[] = [
  { id: "pickup", label: "Pickup" },
  { id: "return", label: "Return" },
  { id: "condition", label: "Item Condition" },
  { id: "charges", label: "Charges & Payments" },
  { id: "complete", label: "Complete Rental" },
];

function firstIncompleteTab(ctx: FulfillmentPanelContext): TabId {
  if (ctx.status === "returned") return "complete";
  if (!ctx.data.record?.pickedUp) return "pickup";
  if (!ctx.data.record.returned) return "return";
  if (!ctx.data.record.itemCondition) return "condition";
  return "complete";
}

export default function RentalFulfillment({ ctx }: { ctx: FulfillmentPanelContext }) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>(() => firstIncompleteTab(ctx));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const owed = computeAmountOwed({ totalAmount: ctx.totalAmount, verifiedPaid: ctx.verifiedPaid, charges: ctx.data.charges });
  const blockers = getCompletionBlockers({
    status: ctx.status,
    pickedUp: ctx.data.record?.pickedUp ?? false,
    returned: ctx.data.record?.returned ?? false,
    itemCondition: ctx.data.record?.itemCondition ?? null,
    charges: ctx.data.charges,
    totalAmount: ctx.totalAmount,
    verifiedPaid: ctx.verifiedPaid,
    pendingPaymentReviews: ctx.pendingPaymentReviews,
  });

  async function finishRental() {
    setBusy(true);
    try {
      const result = await completeRental(ctx.bookingId, note);
      await ctx.onChanged();
      if (result.emailSent) {
        showToast("Rental completed and the customer was emailed.", "success");
      } else {
        showToast("Rental completed. The completion email could not be sent; contact the customer directly.", "warning");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The rental could not be completed.", "error");
    } finally {
      setBusy(false);
    }
  }

  const done: Record<TabId, boolean> = {
    pickup: ctx.data.record?.pickedUp === true,
    return: ctx.data.record?.returned === true,
    condition: ctx.data.record?.itemCondition != null,
    charges: owed.totalOwed === 0,
    complete: ctx.status === "returned",
  };

  return (
    <div>
      <nav className={styles.tabs} role="tablist" aria-label="Rental fulfillment steps">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`fulfillment-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`fulfillment-panel-${tab.id}`}
            className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
            <span className={`${styles.tabState} ${done[tab.id] ? styles.tabStateDone : ""}`}>
              {done[tab.id] ? "Done" : "To do"}
            </span>
          </button>
        ))}
      </nav>

      <div id="fulfillment-panel-pickup" role="tabpanel" aria-labelledby="fulfillment-tab-pickup" hidden={activeTab !== "pickup"}>
        <PickupPanel ctx={ctx} onOpenCharges={() => setActiveTab("charges")} />
      </div>
      <div id="fulfillment-panel-return" role="tabpanel" aria-labelledby="fulfillment-tab-return" hidden={activeTab !== "return"}>
        <ReturnPanel ctx={ctx} />
      </div>
      <div id="fulfillment-panel-condition" role="tabpanel" aria-labelledby="fulfillment-tab-condition" hidden={activeTab !== "condition"}>
        <ItemConditionPanel ctx={ctx} onOpenCharges={() => setActiveTab("charges")} />
      </div>
      <div id="fulfillment-panel-charges" role="tabpanel" aria-labelledby="fulfillment-tab-charges" hidden={activeTab !== "charges"}>
        <ChargesPaymentsPanel ctx={ctx} />
      </div>
      <section id="fulfillment-panel-complete" role="tabpanel" aria-labelledby="fulfillment-tab-complete" hidden={activeTab !== "complete"} className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Complete Rental</h2>
          <p>Confirm the rental after the return, item condition and payment details are recorded.</p>
        </div>
        {ctx.status === "returned" ? (
          <p className={styles.noticeSuccess}>This rental is complete.</p>
        ) : blockers.length ? (
          <div className={styles.noticeWarning}>
            <strong>Finish these steps first:</strong>
            <ul>
              {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
            <div className={styles.actions}>
              {blockers.some((blocker) => blocker.includes("Pickup")) ? <Button variant="secondary" type="button" onClick={() => setActiveTab("pickup")}>Open Pickup</Button> : null}
              {blockers.some((blocker) => blocker.includes("return")) ? <Button variant="secondary" type="button" onClick={() => setActiveTab("return")}>Open Return</Button> : null}
              {blockers.some((blocker) => blocker.includes("condition")) ? <Button variant="secondary" type="button" onClick={() => setActiveTab("condition")}>Open Item Condition</Button> : null}
              {blockers.some((blocker) => /charge|balance/i.test(blocker)) ? <Button variant="secondary" type="button" onClick={() => setActiveTab("charges")}>Open Charges &amp; Payments</Button> : null}
            </div>
          </div>
        ) : (
          <>
            <label className={styles.field}>
              <span>Admin note (optional)</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} disabled={busy} placeholder="Add a note to the booking history" />
            </label>
            <div className={styles.actions}>
              <Button variant="primary" type="button" onClick={() => void finishRental()} loading={busy} loadingText="Completing rental...">
                Complete Rental
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
