import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/lib/supabase/database.types";
import { mapPaymentSubmission } from "@/src/services/paymentService";
import type { PayMongoWebhookEvent, PaymentRecord } from "@/src/types/payment";
import type { AuditLogEntry } from "@/src/types/admin";

/** Admin-only (RLS payments_admin_manage grants a full read to active admins). */
export async function getAllPaymentRecords(supabase: SupabaseClient<Database>): Promise<PaymentRecord[]> {
  const { data, error } = await supabase
    .from("booking_payment_submissions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapPaymentSubmission);
}

export async function getPaymentEvents(supabase: SupabaseClient<Database>): Promise<PayMongoWebhookEvent[]> {
  const { data, error } = await supabase
    .from("paymongo_webhook_events")
    .select("*")
    .order("received_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map(
    (row): PayMongoWebhookEvent => ({
      id: row.id,
      providerEventId: row.provider_event_id,
      eventType: row.event_type,
      payload: row.payload as Record<string, unknown>,
      signatureValid: row.signature_valid,
      processingStatus: row.processing_status as PayMongoWebhookEvent["processingStatus"],
      errorMessage: row.error_message ?? undefined,
      paymentSubmissionId: row.payment_record_id ?? undefined,
      receivedAt: row.received_at,
      processedAt: row.processed_at ?? undefined,
    }),
  );
}

export async function getAuditLogs(supabase: SupabaseClient<Database>): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map(
    (row): AuditLogEntry => ({
      id: row.id,
      actorUserId: row.actor_user_id ?? undefined,
      actorType: row.actor_type as AuditLogEntry["actorType"],
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id ?? undefined,
      bookingId: row.booking_id ?? undefined,
      previousValues: (row.previous_values as Record<string, unknown>) ?? undefined,
      newValues: (row.new_values as Record<string, unknown>) ?? undefined,
      metadata: row.metadata as Record<string, unknown>,
      ipAddress: row.ip_address ? String(row.ip_address) : undefined,
      userAgent: row.user_agent ?? undefined,
      createdAt: row.created_at,
    }),
  );
}

/**
 * public.payment_event_logs no longer exists — the closest equivalent is
 * public.audit_logs filtered to payment-submission entity events (see the
 * 'payment.verified' / 'payment.checkout_created' actions logged by
 * paymentFulfillment.ts and the manual GCash submission route).
 */
export async function getPaymentAuditLogs(supabase: SupabaseClient<Database>): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("entity_type", "payment_submission")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map(
    (row): AuditLogEntry => ({
      id: row.id,
      actorUserId: row.actor_user_id ?? undefined,
      actorType: row.actor_type as AuditLogEntry["actorType"],
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id ?? undefined,
      bookingId: row.booking_id ?? undefined,
      previousValues: (row.previous_values as Record<string, unknown>) ?? undefined,
      newValues: (row.new_values as Record<string, unknown>) ?? undefined,
      metadata: row.metadata as Record<string, unknown>,
      ipAddress: row.ip_address ? String(row.ip_address) : undefined,
      userAgent: row.user_agent ?? undefined,
      createdAt: row.created_at,
    }),
  );
}
