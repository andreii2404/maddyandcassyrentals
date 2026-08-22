import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/src/lib/supabase/database.types";
import { mapPaymentSubmission } from "@/src/services/paymentService";
import { resolveAccountName } from "@/src/lib/accountDisplay";
import type { AdminPaymentRecord } from "@/src/types/payment";
import type { AuditLogEntry } from "@/src/types/admin";

export interface PaymentRecordsPage {
  records: AdminPaymentRecord[];
  total: number;
}

type PaymentSubmissionWithContextRow = Tables<"booking_payment_submissions"> & {
  customer_documents: { storage_bucket: string; storage_path: string; original_filename: string | null } | null;
  bookings: { booking_reference: string; customer_id: string } | null;
};

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
    .select(
      "*, customer_documents(storage_bucket, storage_path, original_filename), bookings(booking_reference, customer_id)",
      { count: "exact" },
    )
    .is("paymongo_payment_id", null)
    .order("created_at", { ascending: false });

  const search = options.search?.trim();
  if (search) {
    const pattern = toIlikePattern(search);
    query = query.or(
      [
        `external_reference.ilike.${pattern}`,
        `status.ilike.${pattern}`,
        `booking_id::text.ilike.${pattern}`,
      ].join(","),
    );
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as PaymentSubmissionWithContextRow[];
  const customerIds = Array.from(
    new Set(rows.map((row) => row.bookings?.customer_id).filter((id): id is string => Boolean(id))),
  );
  const { data: profiles, error: profilesError } = customerIds.length
    ? await supabase.from("profiles").select("id, display_name, contact_email").in("id", customerIds)
    : { data: [], error: null };
  if (profilesError) throw new Error(profilesError.message);
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  const records = rows.map((row): AdminPaymentRecord => {
    const profile = row.bookings?.customer_id ? profileById.get(row.bookings.customer_id) : undefined;
    return {
      ...mapPaymentSubmission(row),
      bookingRef: row.bookings?.booking_reference ?? "Unknown booking",
      customerName: resolveAccountName({ displayName: profile?.display_name, email: profile?.contact_email }),
    };
  });

  return { records, total: count ?? 0 };
}

/** Lightweight aggregate for the Payments dashboard cards — kept independent of the paginated table query. */
export async function getPaymentMetricsSummary(
  supabase: SupabaseClient<Database>,
): Promise<PaymentMetricsSummary> {
  const { data, error } = await supabase
    .from("booking_payment_submissions")
    .select("status, declared_amount")
    .is("paymongo_payment_id", null);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const verified = rows.filter((row) => row.status === "verified");
  return {
    verifiedRevenue: verified.reduce((sum, row) => sum + row.declared_amount, 0),
    successfulPayments: verified.length,
    pendingCheckouts: rows.filter((row) => row.status === "submitted" || row.status === "under_review").length,
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
