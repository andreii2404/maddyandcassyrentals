import type { Product } from "@/types/product";
import type { BookingStatus } from "@/src/types/booking";
import type { PaymentRecord, PayMongoWebhookEvent } from "@/src/types/payment";
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
  payments: PaymentRecord[];
  events: PayMongoWebhookEvent[];
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

export function getAdminPayments(): Promise<AdminPaymentsData> {
  return getAdminData("/api/admin/payments");
}

export async function getAdminPaymentProofUrl(paymentId: string): Promise<string> {
  const data = await getAdminData<{ url: string }>(`/api/admin/payments/${encodeURIComponent(paymentId)}/proof`);
  return data.url;
}

export async function reviewManualPayment(
  paymentId: string,
  action: "verify" | "reject",
  notes: string,
): Promise<void> {
  const response = await fetch(`/api/admin/payments/${encodeURIComponent(paymentId)}/review`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, notes }),
  });
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "The payment review could not be completed.");
  }
}

export function getAdminReviews(): Promise<AdminReviewsData> {
  return getAdminData("/api/admin/reviews");
}
