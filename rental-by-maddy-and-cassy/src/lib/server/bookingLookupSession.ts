import "server-only";

import type { User } from "@supabase/supabase-js";
import { requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";

/**
 * Track Booking works with or without a session. Returns the signed-in (or
 * anonymous guest) caller, or null when there is no valid session. Suspended
 * accounts and profile lookup failures still raise.
 */
export async function optionalLookupUser(): Promise<User | null> {
  try {
    return (await requireUser()).user;
  } catch (error) {
    if (error instanceof RequestSecurityError && error.status === 401) return null;
    throw error;
  }
}
