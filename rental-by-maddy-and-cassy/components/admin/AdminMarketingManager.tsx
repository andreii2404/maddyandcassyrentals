"use client";

import { useEffect, useState } from "react";
import styles from "./AdminMarketingManager.module.css";

interface PromotionRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  max_discount_amount: number | null;
  min_subtotal: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  usage_limit: number | null;
  per_customer_limit: number;
  current_uses: number;
  status: "scheduled" | "active" | "expired" | "inactive";
  redemptionCount: number;
  totalDiscountGiven: number;
}

const emptyForm = {
  code: "",
  title: "",
  description: "",
  discountType: "fixed" as "fixed" | "percentage",
  discountValue: "",
  maxDiscountAmount: "",
  minSubtotal: "0",
  startsAt: "",
  endsAt: "",
  usageLimit: "",
  perCustomerLimit: "1",
};

function money(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminMarketingManager() {
  const [activeTab, setActiveTab] = useState<"promotions" | "subscribers" | "metrics">("promotions");
  const [promotions, setPromotions] = useState<PromotionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadPromotions() {
    setLoading(true);
    setError(null);
    setRowError(null);
    try {
      const response = await fetch("/api/admin/promotions");
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Promotions could not be loaded.");
      setPromotions(body.promotions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Promotions could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPromotions();
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setFormError(null);
    try {
      const response = await fetch("/api/admin/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          title: form.title,
          description: form.description,
          discountType: form.discountType,
          discountValue: Number(form.discountValue),
          maxDiscountAmount: form.maxDiscountAmount ? Number(form.maxDiscountAmount) : null,
          minSubtotal: Number(form.minSubtotal || 0),
          startsAt: form.startsAt,
          endsAt: form.endsAt,
          usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
          perCustomerLimit: Number(form.perCustomerLimit || 1),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "The promotion could not be created.");
      setForm(emptyForm);
      await loadPromotions();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "The promotion could not be created.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(promotion: PromotionRow) {
    setRowError(null);
    try {
      const response = await fetch(`/api/admin/promotions/${promotion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !promotion.is_active }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "The promotion could not be updated.");
      }
      await loadPromotions();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "The promotion could not be updated.");
    }
  }

  return (
    <div className={styles.wrapper}>
      <h1 className={styles.heading}>Marketing</h1>
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "promotions"}
          className={activeTab === "promotions" ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab("promotions")}
        >
          Promotions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "subscribers"}
          className={activeTab === "subscribers" ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab("subscribers")}
        >
          Subscribers
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "metrics"}
          className={activeTab === "metrics" ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab("metrics")}
        >
          Metrics
        </button>
      </div>

      {activeTab === "promotions" ? (
        <>
          <form className={styles.form} onSubmit={handleCreate}>
            <h2 className={styles.sectionHeading}>Create a promotion</h2>
            <div className={styles.formRow}>
              <label>
                Code
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  required
                  maxLength={32}
                />
              </label>
              <label>
                Title
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={120} />
              </label>
            </div>
            <label className={styles.fullWidth}>
              Description
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} />
            </label>
            <div className={styles.formRow}>
              <label>
                Discount type
                <select
                  value={form.discountType}
                  onChange={(e) => setForm({ ...form, discountType: e.target.value as "fixed" | "percentage" })}
                >
                  <option value="fixed">Fixed amount (PHP)</option>
                  <option value="percentage">Percentage</option>
                </select>
              </label>
              <label>
                Discount value
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.discountValue}
                  onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                  required
                />
              </label>
              {form.discountType === "percentage" ? (
                <label>
                  Max discount (PHP, optional cap)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.maxDiscountAmount}
                    onChange={(e) => setForm({ ...form, maxDiscountAmount: e.target.value })}
                  />
                </label>
              ) : null}
            </div>
            <div className={styles.formRow}>
              <label>
                Minimum subtotal (PHP)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.minSubtotal}
                  onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })}
                />
              </label>
              <label>
                Usage limit (optional)
                <input type="number" min="1" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} />
              </label>
              <label>
                Per-customer limit
                <input
                  type="number"
                  min="1"
                  value={form.perCustomerLimit}
                  onChange={(e) => setForm({ ...form, perCustomerLimit: e.target.value })}
                />
              </label>
            </div>
            <div className={styles.formRow}>
              <label>
                Starts
                <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} required />
              </label>
              <label>
                Ends
                <input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} required />
              </label>
            </div>
            {formError ? (
              <p className={styles.error} role="alert">
                {formError}
              </p>
            ) : null}
            <button type="submit" disabled={creating} className={styles.submitButton}>
              {creating ? "Creating…" : "Create promotion"}
            </button>
          </form>

          <h2 className={styles.sectionHeading}>Active &amp; scheduled promotions</h2>
          {rowError ? (
            <div className={styles.rowError} role="alert">
              <span>{rowError}</span>
              <button
                type="button"
                className={styles.dismissButton}
                onClick={() => setRowError(null)}
                aria-label="Dismiss error"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {loading ? (
            <p className={styles.loading}>Loading promotions…</p>
          ) : error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : promotions.length === 0 ? (
            <p className={styles.empty}>No promotions yet. Create one above.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Title</th>
                  <th>Discount</th>
                  <th>Window</th>
                  <th>Status</th>
                  <th>Uses</th>
                  <th>Discount given</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((promo) => (
                  <tr key={promo.id}>
                    <td>{promo.code}</td>
                    <td>{promo.title}</td>
                    <td>{promo.discount_type === "percentage" ? `${promo.discount_value}%` : money(promo.discount_value)}</td>
                    <td>
                      {new Date(promo.starts_at).toLocaleDateString()} – {new Date(promo.ends_at).toLocaleDateString()}
                    </td>
                    <td>
                      <span className={styles[`status_${promo.status}`]}>{promo.status}</span>
                    </td>
                    <td>
                      {promo.redemptionCount}
                      {promo.usage_limit ? ` / ${promo.usage_limit}` : ""}
                    </td>
                    <td>{money(promo.totalDiscountGiven)}</td>
                    <td>
                      <button type="button" className={styles.linkButton} onClick={() => toggleActive(promo)}>
                        {promo.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : activeTab === "subscribers" ? (
        <p className={styles.empty}>Coming soon.</p>
      ) : (
        <p className={styles.empty}>Coming soon.</p>
      )}
    </div>
  );
}
