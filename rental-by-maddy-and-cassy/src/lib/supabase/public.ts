import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getSharedBrowserClient } from "./browserSingleton";

let serverPublicClient: ReturnType<typeof createSupabaseClient<Database>> | null = null;

/**
 * Anonymous-role Supabase client with no cookie/session binding. Safe to use
 * from ISR/static Server Components (unlike src/lib/supabase/server.ts,
 * which calls next/headers cookies() and forces dynamic rendering) and from
 * Client Components rendering guest-visible catalog data. RLS still applies
 * as the `anon` role — never returns anything beyond what
 * `to anon, authenticated` policies expose.
 */
export function createPublicClient() {
  // Client Components must use the application's one authenticated browser
  // client. Creating a separate anonymous supabase-js client here also creates
  // a second GoTrueClient for the same project and can race session refreshes.
  if (typeof window !== "undefined") return getSharedBrowserClient();

  if (serverPublicClient) return serverPublicClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase public client is missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }

  serverPublicClient = createSupabaseClient<Database>(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return serverPublicClient;
}
