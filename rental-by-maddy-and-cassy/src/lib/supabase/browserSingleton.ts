import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type BrowserClient = SupabaseClient<Database>;

const browserGlobal = globalThis as typeof globalThis & {
  __maddyCassySupabaseBrowserClient?: BrowserClient;
};

/**
 * One browser client for the entire application, including during Fast
 * Refresh. Keeping it on globalThis prevents a replaced module from creating
 * another GoTrueClient with the same auth-storage key.
 */
export function getSharedBrowserClient(): BrowserClient {
  if (typeof window === "undefined") {
    throw new Error("The Supabase browser client can only be created in a browser.");
  }

  if (browserGlobal.__maddyCassySupabaseBrowserClient) {
    return browserGlobal.__maddyCassySupabaseBrowserClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase browser client is missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  browserGlobal.__maddyCassySupabaseBrowserClient = createBrowserClient<Database>(
    url,
    publishableKey,
  );
  return browserGlobal.__maddyCassySupabaseBrowserClient;
}
