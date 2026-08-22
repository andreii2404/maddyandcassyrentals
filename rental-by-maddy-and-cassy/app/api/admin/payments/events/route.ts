import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { getPaymentEventsPage } from "@/src/services/adminReadService";

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
    enforceRateLimit(request, "admin-payment-events-read", 60, 60_000);
    const { supabase } = await requireActiveAdmin();

    const url = new URL(request.url);
    const page = parsePage(url.searchParams.get("page"));
    const pageSize = parsePageSize(url.searchParams.get("pageSize"));

    const { records, total } = await getPaymentEventsPage(supabase, { page, pageSize });

    return NextResponse.json({ events: records, total, page, pageSize });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin webhook event read failed", error);
    return NextResponse.json({ error: "Webhook activity could not be loaded." }, { status: 500 });
  }
}
