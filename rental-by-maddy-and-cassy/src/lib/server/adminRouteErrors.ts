import "server-only";

import { NextResponse } from "next/server";
import { mapFulfillmentRpcError } from "@/src/lib/fulfillmentApiHelpers";
import { RequestSecurityError } from "@/src/lib/server/requestSecurity";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Known database codes become friendly messages; anything else is logged and made generic. */
export function rpcErrorResponse(error: { message?: string } | null, fallback: string, logLabel: string) {
  const mapped = mapFulfillmentRpcError(error?.message ?? "");
  if (mapped) return jsonError(mapped.message, mapped.status);
  console.error(logLabel, error);
  return jsonError(fallback, 500);
}

export function routeFailureResponse(error: unknown, fallback: string, logLabel: string) {
  if (error instanceof RequestSecurityError) return jsonError(error.message, error.status);
  console.error(logLabel, error);
  return jsonError(fallback, 500);
}
