import type { Product } from "@/types/product";
import type { BookingStatus, RequirementsStatus } from "@/src/types/booking";
import type { AdminPaymentRecord } from "@/src/types/payment";
import type { AuditLogEntry } from "@/src/types/admin";

export interface AdminDashboardData {
  metrics: {
    customerAccounts: number;
    verifiedRevenue: number;
    successfulPayments: number;
    failedPayments: number;
    pendingVerification: number;
    activeBookings: number;
    catalogProducts: number;
    completedRentals: number;
    popularProductName: string | null;
    popularProductBookings: number;
  };
  recentBookings: Array<{
    id: string;
    bookingRef: string;
    customerName: string;
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
  };
}

async function getAdminData<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  const body = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "Administrator data could not be loaded.");
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

export function getAdminPayments(params: {
  page: number;
  pageSize: number;
  search?: string;
}): Promise<AdminPaymentsData> {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.search) query.set("search", params.search);
  return getAdminData(`/api/admin/payments?${query.toString()}`);
}

export function getAdminReviews(): Promise<AdminReviewsData> {
  return getAdminData("/api/admin/reviews");
}
