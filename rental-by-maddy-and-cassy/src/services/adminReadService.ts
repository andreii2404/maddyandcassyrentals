import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/lib/supabase/database.types";
import { mapPaymentSubmission } from "@/src/services/paymentService";
import type { PayMongoWebhookEvent, PaymentRecord } from "@/src/types/payment";
import type { AuditLogEntry } from "@/src/types/admin";

export interface PaymentRecordsPage {
  records: PaymentRecord[];
  total: number;
}

export interface PaymentEventsPage {
  records: PayMongoWebhookEvent[];
  total: number;
}

export interface PaymentMetricsSummary {
  verifiedRevenue: number;
  successfulPayments: number;
  pendingCheckouts: number;
}

/** Escapes a user-supplied search term for safe use inside a PostgREST ilike/or() filter string. */
function toIlikePattern(term: string): string {
  const safe = term.replace(/[%_,()\\]/g, (char) => `\\${char}`);
  return `%${safe}%`;
}

/** Admin-only (RLS payments_admin_manage grants a full read to active admins). */
export async function getPaymentRecordsPage(
  supabase: SupabaseClient<Database>,
  options: { page: number; pageSize: number; search?: string },
): Promise<PaymentRecordsPage> {
  const page = Math.max(1, Math.floor(options.page));
  const pageSize = options.pageSize;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("booking_payment_submissions")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  const search = options.search?.trim();
  if (search) {
    const pattern = toIlikePattern(search);
    query = query.or(
      [
        `external_reference.ilike.${pattern}`,
        `paymongo_payment_id.ilike.${pattern}`,
        `payment_method.ilike.${pattern}`,
        `status.ilike.${pattern}`,
        `booking_id::text.ilike.${pattern}`,
      ].join(","),
    );
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw new Error(error.message);
  return { records: (data ?? []).map(mapPaymentSubmission), total: count ?? 0 };
}

/** Lightweight aggregate for the Payments dashboard cards — kept independent of the paginated table query. */
export async function getPaymentMetricsSummary(
  supabase: SupabaseClient<Database>,
): Promise<PaymentMetricsSummary> {
  const { data, error } = await supabase.from("booking_payment_submissions").select("status, declared_amount");
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const verified = rows.filter((row) => row.status === "verified");
  return {
    verifiedRevenue: verified.reduce((sum, row) => sum + row.declared_amount, 0),
    successfulPayments: verified.length,
    pendingCheckouts: rows.filter((row) => row.status === "submitted" || row.status === "under_review").length,
  };
}

export async function getPaymentEventsPage(
  supabase: SupabaseClient<Database>,
  options: { page: number; pageSize: number },
): Promise<PaymentEventsPage> {
  const page = Math.max(1, Math.floor(options.page));
  const pageSize = options.pageSize;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("paymongo_webhook_events")
    .select("*", { count: "exact" })
    .order("received_at", { ascending: false })
    .range(from, to);
  if (error) throw new Error(error.message);
  return {
    records: (data ?? []).map(
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
    ),
    total: count ?? 0,
  };
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
 * 'payment.verified' / 'payment.reviewed' / 'payment.proof_submitted' actions
 * logged by paymentFulfillment.ts and the manual GCash payment routes under
 * app/api/bookings/[bookingId]/payment/ and app/api/admin/bookings/[bookingId]/payments/).
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
