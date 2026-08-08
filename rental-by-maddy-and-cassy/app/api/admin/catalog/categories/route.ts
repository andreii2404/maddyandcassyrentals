import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";

function parseCategoryInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_CATEGORY_INPUT");
  const input = value as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 100) : "";
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 500) : "";
  const sortOrder = Number(input.sortOrder ?? 0);
  if (!name || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000) {
    throw new Error("INVALID_CATEGORY_INPUT");
  }
  return { name, description, sortOrder };
}

function categorySlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
  return `${base || "category"}-${Date.now().toString(36)}`;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-categories", 30, 60_000);
    const { supabase } = await requireActiveAdmin();
    const input = parseCategoryInput(await request.json());

    const { data: duplicate } = await supabase
      .from("categories")
      .select("id")
      .ilike("name", input.name)
      .maybeSingle();
    if (duplicate) return NextResponse.json({ error: "A category with this name already exists." }, { status: 409 });

    const { data, error } = await supabase
      .from("categories")
      .insert({
        name: input.name,
        slug: categorySlug(input.name),
        description: input.description || null,
        sort_order: input.sortOrder,
        is_active: true,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "The category could not be created.");

    await supabase.rpc("log_audit_event", {
      p_action: "catalog.category_created",
      p_entity_type: "category",
      p_entity_id: data.id,
      p_new_values: { name: input.name, sortOrder: input.sortOrder },
    });

    return NextResponse.json({ categoryId: data.id }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message === "INVALID_CATEGORY_INPUT") {
      return NextResponse.json({ error: "Enter a valid category name and display order." }, { status: 400 });
    }
    console.error("Category creation failed", error);
    return NextResponse.json({ error: "The category could not be created." }, { status: 500 });
  }
}
