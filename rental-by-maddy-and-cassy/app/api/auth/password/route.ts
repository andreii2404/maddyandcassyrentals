import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isStrongPassword } from "@/src/lib/authValidation";
import { enforceRateLimit, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createClient } from "@/src/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    enforceRateLimit(request, "password-recovery", 6, 10 * 60_000);
    const cookieStore = await cookies();
    if (cookieStore.get("maddy_password_recovery")?.value !== "1") {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired." },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
    const password = typeof body?.password === "string" ? body.password : "";
    if (!isStrongPassword(password)) {
      return NextResponse.json(
        { error: "Use a password with at least 8 characters, uppercase, lowercase, and a number." },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "This reset session has expired." }, { status: 401 });
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      const message = error.message.toLowerCase().includes("same password")
        ? "Choose a password you have not used for this account."
        : "Your password could not be updated. Request a new reset link.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    cookieStore.delete("maddy_password_recovery");
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error && error.message.includes("Too many")
      ? error.message
      : "Your password could not be updated. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
