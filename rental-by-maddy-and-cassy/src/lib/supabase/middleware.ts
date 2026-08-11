import "server-only";

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";

/**
 * Refreshes the Supabase session cookie on every request. Must run in
 * `middleware.ts` for every path that reads auth state, per the
 * @supabase/ssr requirement that session refresh happens before Server
 * Components read cookies.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return response;
  }

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // @supabase/ssr supplies private/no-store headers whenever it rotates
        // auth cookies. Preserve them on the rebuilt middleware response so a
        // CDN cannot cache a stale signed-out or signed-in session response.
        for (const [name, value] of Object.entries(headers)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  // Required: this call refreshes the session and must not be removed even
  // though the returned user is unused here.
  await supabase.auth.getUser();

  return response;
}
