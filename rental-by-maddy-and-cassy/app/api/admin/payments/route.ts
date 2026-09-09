import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { getPaymentRecordsPage, getPaymentMetricsSummary } from "@/src/services/adminReadService";

export const runtime = "nodejs";

const ALLOWED_PAGE_SIZES = new Set([10, 25, 50]);
const DEFAULT_PAGE_SIZE = 10;

function parsePageSize(raw: string | null): number {
  const value = Number(raw);
  return ALLOWED_PAGE_SIZES.has(value) ? value : DEFAULT_PAGE_SIZE;
}

function parsePage(raw: string | null): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-payments-read", 60, 60_000);
    const { supabase } = await requireActiveAdmin();

    const url = new URL(request.url);
    const page = parsePage(url.searchParams.get("page"));
    const pageSize = parsePageSize(url.searchParams.get("pageSize"));
    const search = url.searchParams.get("search") ?? undefined;

    const [{ records, total }, metrics] = await Promise.all([
      getPaymentRecordsPage(supabase, { page, pageSize, search }),
      getPaymentMetricsSummary(supabase),
    ]);

    return NextResponse.json({ payments: records, total, page, pageSize, metrics });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // Always log the full underlying error server-side (Supabase/PostgREST message,
    // code, stack). Keep the user-facing message generic in production, but echo the
    // real cause in the response outside production so it shows up in the Network tab.
    console.error("Admin payment activity read failed", error);
    const payload: { error: string; detail?: string } = {
      error: "Payment activity could not be loaded.",
    };
    if (process.env.NODE_ENV !== "production") {
      payload.detail = error instanceof Error ? error.message : String(error);
    }
    return NextResponse.json(payload, { status: 500 });
  }
}
