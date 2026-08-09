"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/ToastProvider";
import { updateAccountAsAdmin } from "@/src/services/userService";
import type { UserProfile } from "@/src/types/database";
import {
  isValidPhoneNumber,
  normalizePhoneInput,
  PHONE_DIGIT_COUNT,
} from "@/src/lib/authValidation";
import styles from "./AccountManagementPanel.module.css";

export default function AccountManagementPanel({
  account,
  isAdministrator,
}: {
  account: UserProfile;
  isAdministrator: boolean;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState({
    displayName: account.displayName ?? "",
    phoneNumber: account.phoneNumber ?? "",
    fullAddress: account.fullAddress ?? "",
    accountStatus: account.accountStatus,
    role: (isAdministrator ? "admin" : "customer") as UserProfile["role"],
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (form.displayName.trim().length < 2) {
      showToast("Enter the account holder's full name.", "error");
      return;
    }
    if (!isValidPhoneNumber(form.phoneNumber)) {
      showToast(`Phone number must contain exactly ${PHONE_DIGIT_COUNT} digits.`, "error");
      return;
    }
    setSaving(true);
    try {
      await updateAccountAsAdmin(account.id, form);
      showToast("Account access and profile updated.", "success");
      window.location.reload();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The account could not be updated.", "error");
      setSaving(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div><h2>Account Access &amp; Role</h2><p>Edit profile details, suspend access, or manage administrator privileges.</p></div>
      </div>
      <div className={styles.grid}>
        <label><span>Display name</span><input value={form.displayName} onChange={(e)=>setForm({...form,displayName:e.target.value})} /></label>
        <label><span>Phone number</span><input type="tel" inputMode="numeric" autoComplete="tel" maxLength={PHONE_DIGIT_COUNT} value={form.phoneNumber} onChange={(e)=>setForm({...form,phoneNumber:normalizePhoneInput(e.target.value)})} /><small>Exactly 11 digits</small></label>
        <label className={styles.wide}><span>Full address</span><input value={form.fullAddress} onChange={(e)=>setForm({...form,fullAddress:e.target.value})} /></label>
        <label><span>Account status</span><select value={form.accountStatus} onChange={(e)=>setForm({...form,accountStatus:e.target.value as UserProfile["accountStatus"]})}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
        <label><span>Role</span><select value={form.role} onChange={(e)=>setForm({...form,role:e.target.value as UserProfile["role"]})}><option value="customer">Customer</option><option value="admin">Administrator</option></select></label>
      </div>
      <button type="button" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Account Changes"}</button>
    </section>
  );
}
