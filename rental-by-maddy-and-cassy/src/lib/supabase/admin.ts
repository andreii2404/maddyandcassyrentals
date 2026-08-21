import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

let serviceClient: ReturnType<typeof createSupabaseClient<Database>> | null = null;

/**
 * Service-role Supabase client. Bypasses Row Level Security entirely.
 *
 * Only import this from server-only code that has already independently
 * verified the caller (e.g. after `requireActiveAdmin()`, or inside the
 * PayMongo webhook handler after signature verification). Never import this
 * module from a Client Component or expose `SUPABASE_SECRET_KEY` to the
 * browser.
 */
export function createAdminClient() {
  if (serviceClient) {
    return serviceClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error("Supabase admin client is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.");
  }

  serviceClient = createSupabaseClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return serviceClient;
}
