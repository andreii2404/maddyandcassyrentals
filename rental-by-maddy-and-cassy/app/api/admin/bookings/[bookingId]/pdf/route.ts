import { NextResponse } from "next/server";
import { requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { getBookingDetails } from "@/src/services/bookingDetailService";
import { createAdminClient } from "@/src/lib/supabase/admin";
import {
  createBookingReportPdf,
  type BookingReportAttachment,
  type BookingReportSection,
} from "@/src/lib/pdf/bookingReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function formatStatus(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | undefined | null, includeTime = false): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit", hour12: true } : {}),
  });
}

function fileNameFromPath(path: string): string {
  return path.split("/").pop() || "attachment";
}

export async function GET(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    await requireActiveAdmin();
    const { bookingId } = await params;
    const admin = createAdminClient();

    const details = await getBookingDetails(admin, bookingId);
    if (!details) return errorResponse("The selected booking no longer exists.", 404);

    const { booking, emergencyContact, agreement, statusHistory, documents } = details;
    const customerSignature = agreement?.signatures?.find((s) => s.signerRole === "customer");

    const sections: BookingReportSection[] = [
      {
        title: "Booking Overview",
        fields: [
          { label: "Booking reference", value: booking.bookingRef },
          { label: "Booking status", value: formatStatus(booking.status) },
          { label: "Requirements status", value: formatStatus(booking.requirementsStatus) },
          { label: "Agreement status", value: formatStatus(booking.agreementStatus) },
          { label: "Created", value: formatDate(booking.createdAt, true) },
          { label: "Administrator notes", value: booking.adminNotes || "None" },
        ],
      },
      {
        title: "Customer Information",
        fields: [
          { label: "Full name", value: booking.customerSnapshot.fullName },
          { label: "Email address", value: booking.customerSnapshot.email },
          { label: "Phone number", value: booking.customerSnapshot.phone },
          { label: "Complete address", value: booking.customerSnapshot.address },
          { label: "Facebook profile", value: booking.customerSnapshot.facebookLink },
          { label: "Instagram profile", value: booking.customerSnapshot.instagramLink },
        ],
      },
      {
        title: "Rental Details",
        fields: [
          { label: "Product", value: booking.productSnapshot.name },
          { label: "Brand and category", value: `${booking.productSnapshot.brand} / ${booking.productSnapshot.category}` },
          { label: "Daily rate", value: `PHP ${booking.dailyRate.toLocaleString("en-PH")}` },
          { label: "Rental dates", value: `${formatDate(booking.startDate)} to ${formatDate(booking.endDate)}` },
          { label: "Duration", value: `${booking.dayCount} day(s)` },
          { label: "Handover method", value: formatStatus(booking.fulfillmentMethod) },
          { label: "Location", value: booking.location || "-" },
          { label: "Quantity", value: `${booking.quantity} unit(s)` },
          { label: "Rental subtotal", value: `PHP ${booking.rentalSubtotal.toLocaleString("en-PH")}` },
          ...(booking.birthdayDiscountAmount > 0
            ? [{ label: "Birthday month perk", value: `-PHP ${booking.birthdayDiscountAmount.toLocaleString("en-PH")}` }]
            : []),
          ...(booking.loyaltyDiscountAmount > 0
            ? [{ label: "11th-rental loyalty reward", value: `-PHP ${booking.loyaltyDiscountAmount.toLocaleString("en-PH")}` }]
            : []),
          { label: "Non-refundable deposit", value: `PHP ${booking.refundableDeposit.toLocaleString("en-PH")}` },
          { label: "Total amount", value: `PHP ${booking.totalAmount.toLocaleString("en-PH")}` },
          { label: "Assigned physical unit", value: booking.inventoryUnitId || "Not assigned" },
        ],
      },
      {
        title: "Emergency Contact",
        fields: [
          { label: "Full name", value: emergencyContact?.fullName || "-" },
          { label: "Relationship", value: emergencyContact?.relationship || "-" },
          { label: "Phone number", value: emergencyContact?.phoneNumber || "-" },
          { label: "Address", value: emergencyContact?.address || "-" },
        ],
      },
      {
        title: "Rental Agreement",
        fields: agreement
          ? [
              { label: "Terms version", value: agreement.versionNumber ? `v${agreement.versionNumber}` : "-" },
              { label: "Agreement customer name", value: agreement.agreementSnapshot?.customerName || "-" },
              { label: "Signed name", value: customerSignature?.signerName || "-" },
              { label: "Signed at", value: formatDate(customerSignature?.signedAt, true) },
              { label: "Agreement status", value: formatStatus(agreement.status) },
            ]
          : [{ label: "Agreement", value: "Not yet created" }],
      },
      {
        title: "Status History",
        fields: statusHistory.map((entry, index) => ({
          label: `Action ${index + 1} - ${formatDate(entry.createdAt, true)}`,
          value: `${entry.fromStatus ? formatStatus(entry.fromStatus) : "New"} -> ${formatStatus(entry.toStatus)}. ${entry.note ?? ""}`.trim(),
        })),
      },
    ];

    const attachmentEntries = [
      ...documents.map((doc) => ({
        label: formatStatus(doc.documentType),
        bucket: doc.storageBucket,
        path: doc.storagePath,
      })),
      ...(customerSignature?.signaturePath
        ? [{ label: "Customer signature", bucket: "customer-documents", path: customerSignature.signaturePath }]
        : []),
    ];

    const attachments: BookingReportAttachment[] = await Promise.all(
      attachmentEntries.map(async (entry) => {
        try {
          const { data } = await admin.storage.from(entry.bucket).download(entry.path);
          if (!data) throw new Error("missing");
          const bytes = new Uint8Array(await data.arrayBuffer());
          const contentType = data.type;
          const supported =
            contentType.includes("pdf") || contentType.includes("png") || contentType.includes("jpeg") || contentType.includes("jpg");
          return {
            label: entry.label,
            fileName: fileNameFromPath(entry.path),
            bytes: supported ? bytes : undefined,
            contentType,
          };
        } catch {
          return { label: entry.label, fileName: fileNameFromPath(entry.path) };
        }
      }),
    );

    const pdfBytes = await createBookingReportPdf({
      bookingReference: booking.bookingRef,
      generatedAt: new Date().toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "long",
        timeStyle: "short",
      }),
      status: formatStatus(booking.status),
      sections,
      attachments,
    });

    const safeReference = booking.bookingRef.replace(/[^a-zA-Z0-9_-]/g, "_");
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="booking-${safeReference}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Admin booking PDF export failed", error);
    return errorResponse("The booking PDF could not be generated. Please try again.", 500);
  }
}
