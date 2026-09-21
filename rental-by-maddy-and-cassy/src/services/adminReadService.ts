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
  bookings: { booking_reference: string; customer_id: string; is_guest_checkout: boolean; status: string } | null;
};

export interface PaymentMetricsSummary {
  verifiedRevenue: number;
  successfulPayments: number;
  pendingCheckouts: number;
  /** Counts for the Status pill tabs — see app/admin/payments/page.tsx. */
  statusCounts: { all: number; verified: number; unverified: number; rejected: number };
  /** Counts for the Payment Type pill tabs. "fullPayment" and "other" both read the "other" stage — see the comment on PaymentRecordsFilters.stage. */
  stageCounts: { all: number; fullPayment: number; downPayment: number; balance: number; other: number };
}

/** Payment Records filter bar options — see app/admin/payments/page.tsx. */
export interface PaymentRecordsFilters {
  /** "unverified" covers both submitted and under_review, mirroring the "Unverified" label already used in the UI for a raw "submitted" status. */
  status?: "verified" | "unverified" | "rejected";
  /** "full_payment" and "other" both map to the "other" payment_stage — the schema has no separate full-payment stage. */
  stage?: "down_payment" | "balance" | "other";
  accountType?: "with_account" | "guest";
  bookingStatus?: "pending" | "approved" | "returned" | "cancelled";
  proof?: "with_proof" | "no_proof";
  /** Inclusive submission-date range as YYYY-MM-DD, read as Asia/Manila calendar days. */
  dateFrom?: string;
  dateTo?: string;
  sort?: "newest" | "oldest";
}

const MANILA_UTC_OFFSET = "+08:00";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Start of the given Manila calendar day as a UTC ISO timestamp. */
function manilaDayStartIso(day: string): string {
  return new Date(`${day}T00:00:00${MANILA_UTC_OFFSET}`).toISOString();
}

/** Start of the day after the given Manila calendar day — an exclusive upper bound. */
function manilaNextDayStartIso(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00${MANILA_UTC_OFFSET}`) + MS_PER_DAY).toISOString();
}

/** Escapes a user-supplied search term for safe use inside a PostgREST ilike/or() filter string. */
function toIlikePattern(term: string): string {
  const safe = term.replace(/[%_,()\\]/g, (char) => `\\${char}`);
  return `%${safe}%`;
}

/** Admin-only (RLS payments_admin_manage grants a full read to active admins). */
export async function getPaymentRecordsPage(
  supabase: SupabaseClient<Database>,
  options: { page: number; pageSize: number; search?: string; filters?: PaymentRecordsFilters },
): Promise<PaymentRecordsPage> {
  const page = Math.max(1, Math.floor(options.page));
  const pageSize = options.pageSize;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const filters = options.filters ?? {};

  // Every row in booking_payment_submissions is a manual submission now — PayMongo
  // is retired and fulfillVerifiedPayment() reuses paymongo_payment_id as a generic
  // external-reference slot, so filtering on `paymongo_payment_id IS NULL` here would
  // wrongly hide every *verified* payment (and zero out the revenue metric below).
  // bookings!inner is used (rather than the default left embed) so that filtering on
  // bookings.status / bookings.is_guest_checkout also narrows the top-level rows returned —
  // every payment submission has a required booking_id, so this never drops a row that
  // the default embed would otherwise have included.
  let query = supabase
    .from("booking_payment_submissions")
    .select(
      "*, customer_documents(storage_bucket, storage_path, original_filename), bookings!inner(booking_reference, customer_id, is_guest_checkout, status)",
      { count: "exact" },
    )
    .order("created_at", { ascending: filters.sort === "oldest" });

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

  if (filters.status === "verified") query = query.eq("status", "verified");
  else if (filters.status === "rejected") query = query.eq("status", "rejected");
  else if (filters.status === "unverified") query = query.in("status", ["submitted", "under_review"]);

  if (filters.stage) query = query.eq("stage", filters.stage);

  if (filters.proof === "with_proof") query = query.not("proof_document_id", "is", null);
  else if (filters.proof === "no_proof") query = query.is("proof_document_id", null);

  if (filters.accountType === "guest") query = query.eq("bookings.is_guest_checkout", true);
  else if (filters.accountType === "with_account") query = query.eq("bookings.is_guest_checkout", false);

  if (filters.bookingStatus) query = query.eq("bookings.status", filters.bookingStatus);

  if (filters.dateFrom) query = query.gte("created_at", manilaDayStartIso(filters.dateFrom));
  if (filters.dateTo) query = query.lt("created_at", manilaNextDayStartIso(filters.dateTo));

  const { data, error, count } = await query.range(from, to);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as PaymentSubmissionWithContextRow[];
  const profileIds = Array.from(
    new Set(
      rows
        .flatMap((row) => [row.bookings?.customer_id, row.reviewed_by])
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const { data: profiles, error: profilesError } = profileIds.length
    ? await supabase.from("profiles").select("id, display_name, contact_email").in("id", profileIds)
    : { data: [], error: null };
  if (profilesError) throw new Error(profilesError.message);
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  const records = rows.map((row): AdminPaymentRecord => {
    const profile = row.bookings?.customer_id ? profileById.get(row.bookings.customer_id) : undefined;
    const reviewer = row.reviewed_by ? profileById.get(row.reviewed_by) : undefined;
    return {
      ...mapPaymentSubmission(row),
      bookingRef: row.bookings?.booking_reference ?? "Unknown booking",
      customerName: resolveAccountName({ displayName: profile?.display_name, email: profile?.contact_email }),
      isGuestCheckout: row.bookings?.is_guest_checkout ?? false,
      bookingStatus: (row.bookings?.status ?? "pending") as AdminPaymentRecord["bookingStatus"],
      reviewedByName: reviewer?.display_name?.trim() || reviewer?.contact_email?.trim() || undefined,
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
    .select("status, declared_amount, stage");
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const verified = rows.filter((row) => row.status === "verified");
  const unverified = rows.filter((row) => row.status === "submitted" || row.status === "under_review");
  const rejected = rows.filter((row) => row.status === "rejected");
  const otherStage = rows.filter((row) => row.stage === "other").length;
  return {
    verifiedRevenue: verified.reduce((sum, row) => sum + row.declared_amount, 0),
    successfulPayments: verified.length,
    pendingCheckouts: unverified.length,
    statusCounts: { all: rows.length, verified: verified.length, unverified: unverified.length, rejected: rejected.length },
    stageCounts: {
      all: rows.length,
      fullPayment: otherStage,
      downPayment: rows.filter((row) => row.stage === "down_payment").length,
      balance: rows.filter((row) => row.stage === "balance").length,
      other: otherStage,
    },
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
