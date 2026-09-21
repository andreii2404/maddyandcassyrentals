import type { Product } from "@/types/product";
import type { BookingStatus, CancellationRequestStatus, RequirementsStatus } from "@/src/types/booking";
import type { AdminPaymentRecord } from "@/src/types/payment";
import type { AuditLogEntry } from "@/src/types/admin";

export interface AdminDashboardData {
  metrics: {
    customerAccounts: number;
    verifiedRevenue: number;
    successfulPayments: number;
    failedPayments: number;
    pendingVerification: number;
    pendingCancellations: number;
    activeBookings: number;
    catalogProducts: number;
    completedRentals: number;
    popularProductName: string | null;
    popularProductBookings: number;
  };
  cancellationRequests: Array<{
    id: string;
    bookingId: string;
    bookingRef: string;
    customerName: string;
    productName: string;
    reason: string;
    requestedAt: string;
    status: CancellationRequestStatus;
  }>;
  recentBookings: Array<{
    id: string;
    bookingRef: string;
    customerName: string;
    isGuestCheckout: boolean;
    productName: string;
    status: BookingStatus;
    requirementsStatus: RequirementsStatus;
    createdAt: string | null;
  }>;
}

export type AdminAuditLog = AuditLogEntry;

export interface AdminPriceHistoryEntry {
  id: string;
  productId: string;
  previousPrice: number | null;
  newPrice: number;
  changedBy: string | null;
  reason: string;
  createdAt: string | null;
}

export interface AdminCatalogData {
  products: Product[];
  priceHistory: AdminPriceHistoryEntry[];
  categories: AdminCatalogCategory[];
  inventoryUnits: AdminInventoryUnit[];
  reviews: AdminProductReview[];
}

export interface AdminCatalogCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  productCount: number;
}

export interface AdminInventoryUnit {
  id: string;
  productId: string;
  unitCode: string;
  serialNumber: string | null;
  lifecycleStatus: "active" | "maintenance" | "retired";
  conditionNotes: string | null;
  acquiredAt: string | null;
  retiredAt: string | null;
  hasActiveReservation: boolean;
}

export interface AdminProductReview {
  id: string;
  productId: string;
  productName: string;
  rating: number;
  comment: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export interface AdminReviewRecord extends AdminProductReview {
  bookingId: string;
  bookingRef: string;
  bookingStatus: BookingStatus;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  updatedAt: string;
  moderatedAt: string | null;
  moderatorName: string | null;
}

export interface AdminReviewsData {
  reviews: AdminReviewRecord[];
}

export interface AdminPaymentsData {
  payments: AdminPaymentRecord[];
  total: number;
  page: number;
  pageSize: number;
  metrics: {
    verifiedRevenue: number;
    successfulPayments: number;
    pendingCheckouts: number;
    statusCounts: { all: number; verified: number; unverified: number; rejected: number };
    stageCounts: { all: number; fullPayment: number; downPayment: number; balance: number; other: number };
  };
}

async function getAdminData<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: unknown; detail?: unknown })
    | null;
  if (!response.ok) {
    const message =
      typeof body?.error === "string" ? body.error : "Administrator data could not be loaded.";
    // `detail` is only ever populated by the API outside production — surface it so
    // the exact Supabase/database error is visible without digging through logs.
    const detail = typeof body?.detail === "string" ? ` (${body.detail})` : "";
    throw new Error(`${message}${detail}`);
  }
  if (!body) throw new Error("Administrator data could not be loaded.");
  return body;
}

export function getAdminDashboard(): Promise<AdminDashboardData> {
  return getAdminData("/api/admin/dashboard");
}

export function getAdminCatalog(): Promise<AdminCatalogData> {
  return getAdminData("/api/admin/catalog");
}

export async function getAdminAuditLogs(): Promise<AdminAuditLog[]> {
  const data = await getAdminData<{ logs: AdminAuditLog[] }>("/api/admin/audit");
  return data.logs;
}

export interface AdminPaymentsFilters {
  status?: "verified" | "unverified" | "rejected";
  stage?: "full_payment" | "down_payment" | "balance" | "other";
  accountType?: "with_account" | "guest";
  bookingStatus?: "pending" | "approved" | "returned" | "cancelled";
  proof?: "with_proof" | "no_proof";
  /** Inclusive submission-date range as YYYY-MM-DD (Asia/Manila calendar days). */
  dateFrom?: string;
  dateTo?: string;
  sort?: "newest" | "oldest";
}

export function getAdminPayments(params: {
  page: number;
  pageSize: number;
  search?: string;
  filters?: AdminPaymentsFilters;
}): Promise<AdminPaymentsData> {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.search) query.set("search", params.search);
  const filters = params.filters;
  if (filters?.status) query.set("status", filters.status);
  if (filters?.stage) query.set("stage", filters.stage);
  if (filters?.accountType) query.set("accountType", filters.accountType);
  if (filters?.bookingStatus) query.set("bookingStatus", filters.bookingStatus);
  if (filters?.proof) query.set("proof", filters.proof);
  if (filters?.dateFrom) query.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) query.set("dateTo", filters.dateTo);
  if (filters?.sort) query.set("sort", filters.sort);
  return getAdminData(`/api/admin/payments?${query.toString()}`);
}

export function getAdminReviews(): Promise<AdminReviewsData> {
  return getAdminData("/api/admin/reviews");
}
