import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/src/lib/supabase/server";
import type { Database } from "@/src/lib/supabase/database.types";
import { RequestSecurityError } from "@/src/lib/server/requestSecurityError";

export { RequestSecurityError };

type RateBucket = { count: number; resetAt: number };

const globalBuckets = globalThis as typeof globalThis & {
  __maddyCassyRateBuckets?: Map<string, RateBucket>;
};

const buckets =
  globalBuckets.__maddyCassyRateBuckets ??
  (globalBuckets.__maddyCassyRateBuckets = new Map<string, RateBucket>());

export function enforceRateLimit(
  request: Request,
  scope: string,
  limit = 12,
  windowMs = 60_000,
): void {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientKey = forwardedFor || request.headers.get("x-real-ip") || "unknown";
  const key = `${scope}:${clientKey}`;
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (existing.count >= limit) {
    throw new RequestSecurityError(
      "Too many requests. Please wait a moment and try again.",
      429,
    );
  }

  existing.count += 1;
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || "unknown";
}

export interface AuthenticatedRequestContext {
  supabase: SupabaseClient<Database>;
  user: User;
}

/**
 * Resolves the caller from the Supabase session cookie (set by
 * src/lib/supabase/middleware.ts on every request) rather than a manually
 * forwarded bearer token — @supabase/ssr keeps the cookie fresh, so
 * same-origin fetches from client components need no Authorization header.
 */
export async function requireUser(): Promise<AuthenticatedRequestContext> {
  const supabase = await createClient();
  let user: User | null = null;
  try {
    const {
      data,
      error,
    } = await supabase.auth.getUser();

    if (error || !data.user) {
      throw new RequestSecurityError("Your session is invalid or expired.", 401);
    }
    user = data.user;
  } catch {
    // Stale/invalid refresh-token cookies can throw from auth.getUser().
    // Normalize that into a stable 401 for callers.
    throw new RequestSecurityError("Your session is invalid or expired.", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("account_status")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    throw new RequestSecurityError("Your account access could not be verified.", 503);
  }
  if (profile?.account_status === "suspended") {
    throw new RequestSecurityError("This account is suspended. Please contact support.", 403);
  }

  return { supabase, user };
}

export type AuthenticatedAdminContext = AuthenticatedRequestContext;

export async function requireActiveAdmin(): Promise<AuthenticatedAdminContext> {
  const context = await requireUser();
  const { data, error } = await context.supabase.rpc("is_active_admin");

  if (error || data !== true) {
    throw new RequestSecurityError("Active administrator access is required.", 403);
  }

  return context;
}
