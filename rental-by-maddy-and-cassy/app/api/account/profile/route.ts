import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit, requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import type { Database } from "@/src/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const profileUpdateSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(254).optional(),
  displayName: z.string().trim().min(2, "Full name is required.").max(120).optional(),
  phoneNumber: z.string().regex(/^\d{11}$/, "Phone number must contain exactly 11 digits.").optional(),
  birthDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid birth date.")]).optional(),
  fullAddress: z.string().trim().min(5, "Complete address is required.").max(500).optional(),
  facebookLink: z.string().trim().url("Enter a valid Facebook profile link.").max(500).optional(),
  instagramLink: z.string().trim().url("Enter a valid Instagram profile link.").max(500).optional(),
}).strict();

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "customer-profile-update", 12, 60_000);
    const { user } = await requireUser();
    const parsed = profileUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message || "Check the profile details and try again.", 400);
    }

    if (parsed.data.birthDate) {
      const birthDate = new Date(`${parsed.data.birthDate}T00:00:00Z`);
      if (Number.isNaN(birthDate.getTime()) || birthDate > new Date()) {
        return errorResponse("Birth date cannot be in the future.", 400);
      }
    }

    const payload: Database["public"]["Tables"]["profiles"]["Update"] = {};
    if (parsed.data.email !== undefined) payload.contact_email = parsed.data.email;
    if (parsed.data.displayName !== undefined) payload.display_name = parsed.data.displayName;
    if (parsed.data.phoneNumber !== undefined) payload.phone_number = parsed.data.phoneNumber;
    if (parsed.data.birthDate !== undefined) payload.birth_date = parsed.data.birthDate || null;
    if (parsed.data.fullAddress !== undefined) payload.full_address = parsed.data.fullAddress;
    if (parsed.data.facebookLink !== undefined) payload.facebook_url = parsed.data.facebookLink;
    if (parsed.data.instagramLink !== undefined) payload.instagram_url = parsed.data.instagramLink;

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .update(payload)
      .eq("id", user.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) return errorResponse("Your customer profile could not be found.", 404);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Customer profile update failed", error);
    return errorResponse("Your profile could not be updated. Please try again.", 500);
  }
}
