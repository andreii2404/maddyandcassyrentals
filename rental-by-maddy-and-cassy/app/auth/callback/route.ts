import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/src/lib/supabase/server";

export const dynamic = "force-dynamic";

function safeResetDestination(value: string | null): string {
  if (!value || !value.startsWith("/reset-password") || value.startsWith("//")) {
    return "/reset-password";
  }
  return value;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeResetDestination(request.nextUrl.searchParams.get("next"));
  const source = next.includes("source=customer") ? "customer" : "admin";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(new URL(next, request.url));
      response.cookies.set("maddy_password_recovery", "1", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 10 * 60,
      });
      return response;
    }
  }

  return NextResponse.redirect(
    new URL(`/forgot-password?source=${source}&error=invalid_link`, request.url),
  );
}
