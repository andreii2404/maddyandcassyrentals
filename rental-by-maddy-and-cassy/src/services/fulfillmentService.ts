import type { SupabaseClient } from "@supabase/supabase-js";
import { mapCharge, mapCustomerUpdate, mapFulfillmentRecord, mapSecurityDeposit } from "@/src/lib/fulfillmentMappers";
import { validateConditionPhoto } from "@/src/lib/rentalFulfillment";
import type { Database } from "@/src/lib/supabase/database.types";
import { createSignedUrl, STORAGE_BUCKETS } from "@/src/lib/supabase/storage";
import {
  EMPTY_FULFILLMENT_DATA,
  type ApprovalEmailStatus,
  type ChargePaymentMethod,
  type ChargeType,
  type DepositPaymentMethod,
  type FulfillmentData,
  type ItemCondition,
} from "@/src/types/fulfillment";

const GENERIC_FAILURE = "That could not be saved. Please try again.";

export class FulfillmentApiError extends Error {
  blockers: string[];
  constructor(message: string, blockers: string[] = []) {
    super(message);
    this.name = "FulfillmentApiError";
    this.blockers = blockers;
  }
}

function toApprovalEmailStatus(value: string | null): ApprovalEmailStatus {
  return value === "sent" || value === "failed" || value === "legacy" ? value : null;
}

/**
 * Loads everything the Rental Fulfillment view needs. If the fulfillment columns or tables are not
 * available yet (migration not applied), it returns "not available" so the old review page keeps
 * working instead of failing to load.
 */
export async function getFulfillmentData(
  supabase: SupabaseClient<Database>,
  bookingId: string,
): Promise<FulfillmentData> {
  const emailResult = await supabase
    .from("bookings")
    .select("approval_email_status, approval_email_sent_at, completion_email_sent_at, completion_email_to")
    .eq("id", bookingId)
    .maybeSingle();
  if (emailResult.error || !emailResult.data) return EMPTY_FULFILLMENT_DATA;

  const [recordResult, chargesResult, updatesResult] = await Promise.all([
    supabase.from("booking_fulfillment_records").select("*").eq("booking_id", bookingId).maybeSingle(),
    supabase.from("booking_charges").select("*").eq("booking_id", bookingId).order("created_at", { ascending: true }),
    supabase
      .from("booking_customer_updates")
      .select("*")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false }),
  ]);
  if (recordResult.error || chargesResult.error || updatesResult.error) return EMPTY_FULFILLMENT_DATA;

  // Read on its own so a missing deposit table leaves the rest of fulfillment usable. The deposit
  // then counts as unpaid, which keeps the return and completion blocked.
  const depositResult = await supabase
    .from("booking_security_deposits")
    .select("*")
    .eq("booking_id", bookingId)
    .maybeSingle();
  const securityDeposit = !depositResult.error && depositResult.data ? mapSecurityDeposit(depositResult.data) : null;

  const charges = (chargesResult.data ?? []).map(mapCharge);
  const updates = (updatesResult.data ?? []).map(mapCustomerUpdate);

  const adminIds = new Set<string>();
  if (securityDeposit?.recordedBy) adminIds.add(securityDeposit.recordedBy);
  for (const charge of charges) {
    for (const id of [charge.createdBy, charge.paidRecordedBy, charge.voidedBy]) if (id) adminIds.add(id);
  }
  for (const update of updates) if (update.sentBy) adminIds.add(update.sentBy);

  const adminNames: Record<string, string> = {};
  if (adminIds.size > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", [...adminIds]);
    for (const profile of profiles ?? []) {
      if (profile.display_name) adminNames[profile.id] = profile.display_name;
    }
  }

  const email = emailResult.data;
  return {
    available: true,
    email: {
      approvalEmailStatus: toApprovalEmailStatus(email.approval_email_status),
      approvalEmailSentAt: email.approval_email_sent_at ?? undefined,
      completionEmailSentAt: email.completion_email_sent_at ?? undefined,
      completionEmailTo: email.completion_email_to ?? undefined,
    },
    record: recordResult.data ? mapFulfillmentRecord(recordResult.data) : null,
    securityDepositAvailable: !depositResult.error,
    securityDeposit,
    charges,
    updates,
    adminNames,
  };
}

async function callApi<T>(url: string, method: "POST" | "PATCH", body: unknown, fallback = GENERIC_FAILURE): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    // A dropped connection would otherwise surface the browser's raw "Failed to fetch".
    throw new FulfillmentApiError(fallback);
  }

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: unknown; blockers?: unknown })
    | null;
  if (!response.ok) {
    const blockers = Array.isArray(payload?.blockers)
      ? payload.blockers.filter((item): item is string => typeof item === "string")
      : [];
    throw new FulfillmentApiError(typeof payload?.error === "string" ? payload.error : fallback, blockers);
  }
  return (payload ?? {}) as T;
}

const base = (bookingId: string) => `/api/admin/bookings/${encodeURIComponent(bookingId)}`;

export async function recordPickup(bookingId: string, atIso: string, notes: string): Promise<void> {
  await callApi(`${base(bookingId)}/fulfillment`, "POST", { action: "pickup", at: atIso, notes });
}

export async function recordReturn(bookingId: string, atIso: string, notes: string): Promise<void> {
  await callApi(`${base(bookingId)}/fulfillment`, "POST", { action: "return", at: atIso, notes });
}

export async function recordSecurityDeposit(
  bookingId: string,
  input: { method: DepositPaymentMethod; referenceNumber: string; paidAt: string },
): Promise<void> {
  await callApi(
    `${base(bookingId)}/security-deposit`,
    "POST",
    input,
    "The security deposit could not be saved. Please try again.",
  );
}

export async function saveItemCondition(
  bookingId: string,
  input: { condition: ItemCondition; notes: string; photoPaths: string[] },
): Promise<void> {
  await callApi(`${base(bookingId)}/fulfillment`, "POST", { action: "condition", ...input });
}

export async function addCharge(
  bookingId: string,
  input: { chargeType: ChargeType; amount: number; reason: string },
): Promise<string> {
  const result = await callApi<{ chargeId: string }>(`${base(bookingId)}/charges`, "POST", input);
  return result.chargeId;
}

export async function markChargePaid(
  bookingId: string,
  chargeId: string,
  input: { method: ChargePaymentMethod; paidAt: string },
): Promise<void> {
  await callApi(`${base(bookingId)}/charges/${encodeURIComponent(chargeId)}`, "PATCH", {
    action: "mark_paid",
    ...input,
  });
}

export async function voidCharge(bookingId: string, chargeId: string, reason: string): Promise<void> {
  await callApi(`${base(bookingId)}/charges/${encodeURIComponent(chargeId)}`, "PATCH", { action: "void", reason });
}

export async function sendCustomerUpdate(
  bookingId: string,
  input: { subject: string; message: string; adminNote?: string; relatedChargeId?: string },
): Promise<{ updateId: string; delivered: boolean }> {
  const result = await callApi<{ updateId: string; delivered: boolean }>(
    `${base(bookingId)}/customer-updates`,
    "POST",
    input,
    "The message could not be sent. Please try again.",
  );
  return { updateId: result.updateId, delivered: result.delivered === true };
}

export async function resendCustomerUpdate(bookingId: string, updateId: string): Promise<{ delivered: boolean }> {
  const result = await callApi<{ delivered: boolean }>(
    `${base(bookingId)}/customer-updates/${encodeURIComponent(updateId)}`,
    "POST",
    {},
    "The message could not be sent. Please try again.",
  );
  return { delivered: result.delivered === true };
}

export async function completeRental(
  bookingId: string,
  note: string,
): Promise<{ alreadyCompleted: boolean; emailSent: boolean }> {
  let result: { alreadyCompleted: boolean; emailSent: boolean };
  try {
    result = await callApi<{ alreadyCompleted: boolean; emailSent: boolean }>(
      `${base(bookingId)}/complete`,
      "POST",
      { note },
      "The rental could not be completed. Please try again.",
    );
  } catch (error) {
    if (error instanceof FulfillmentApiError && error.blockers.length > 0) {
      throw new FulfillmentApiError(`${error.message} ${error.blockers.join(" ")}`, error.blockers);
    }
    throw error;
  }
  return { alreadyCompleted: result.alreadyCompleted === true, emailSent: result.emailSent === true };
}

export async function resendCompletionEmail(bookingId: string): Promise<{ emailedTo: string }> {
  const result = await callApi<{ emailedTo?: string }>(
    `${base(bookingId)}/completion-email`,
    "POST",
    {},
    "The completion email could not be sent. Please try again.",
  );
  return { emailedTo: result.emailedTo || "the customer" };
}

/** Uploads one condition photo to the private bucket and returns its storage path. */
export async function uploadConditionPhoto(
  supabase: SupabaseClient<Database>,
  bookingId: string,
  file: File,
): Promise<string> {
  const problem = validateConditionPhoto(file);
  if (problem) throw new FulfillmentApiError(problem);

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${bookingId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKETS.conditionPhotos)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new FulfillmentApiError("The photo could not be uploaded. Please try again.");
  return path;
}

export function getConditionPhotoUrl(supabase: SupabaseClient<Database>, path: string): Promise<string> {
  return createSignedUrl(supabase, STORAGE_BUCKETS.conditionPhotos, path);
}

/** ISO timestamp to the value a datetime-local input expects, in the admin's own timezone. */
export function toDateTimeLocalValue(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** datetime-local input value back to an ISO timestamp, or null when it is empty or invalid. */
export function fromDateTimeLocalValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
