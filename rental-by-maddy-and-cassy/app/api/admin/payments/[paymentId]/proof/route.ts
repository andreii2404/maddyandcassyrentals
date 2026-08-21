import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-payment-proof", 60, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { paymentId } = await params;
    const { data: payment } = await supabase
      .from("booking_payment_submissions")
      .select("proof_document_id")
      .eq("id", paymentId)
      .single();
    if (!payment?.proof_document_id) {
      return NextResponse.json({ error: "No manual proof is attached to this payment." }, { status: 404 });
    }
    const { data: document } = await supabase
      .from("customer_documents")
      .select("storage_bucket,storage_path")
      .eq("id", payment.proof_document_id)
      .single();
    if (!document) return NextResponse.json({ error: "The payment proof could not be found." }, { status: 404 });
    const { data, error } = await supabase.storage
      .from(document.storage_bucket)
      .createSignedUrl(document.storage_path, 10 * 60);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? "SIGNED_URL_FAILED");
    return NextResponse.json({ url: data.signedUrl });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin payment proof read failed", error);
    return NextResponse.json({ error: "The payment proof could not be opened." }, { status: 500 });
  }
}
