import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server";
import nodemailer from "npm:nodemailer@7.0.6";
import { paymentRejectionBookingUrl } from "../_shared/paymentRejectionBookingUrl.ts";

const SMTP_HOST = Deno.env.get("GMAIL_SMTP_HOST")!;
const SMTP_PORT = Number(Deno.env.get("GMAIL_SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("GMAIL_SMTP_USER")!;
const SMTP_PASSWORD = Deno.env.get("GMAIL_SMTP_PASSWORD")!;
const FROM_NAME =
  Deno.env.get("GMAIL_FROM_NAME") || "Maddy & Cassy Rentals";

type QueryBuilder = {
  select: (columns: string) => QueryBuilder;
  eq: (column: string, value: string) => QueryBuilder;
  order: (column: string, options: { ascending: boolean }) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
  maybeSingle: () => Promise<{
    data: Record<string, unknown> | null;
    error: Error | null;
  }>;
};

type SupabaseAdminClient = {
  from: (table: string) => QueryBuilder;
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{
        data: Blob | null;
        error: Error | null;
      }>;
    };
  };
};

/*
 * Download the signed rental agreement PDF from Supabase Storage
 * and convert it to Base64 for the Gmail attachment.
 */
async function getContractAttachment(
  supabaseAdmin: SupabaseAdminClient,
  bookingId: string,
  bookingReference: string,
) {
  const { data: agreement, error: agreementError } =
    await supabaseAdmin
      .from("booking_agreements")
      .select("id")
      .eq("booking_id", bookingId)
      .maybeSingle();

  if (agreementError) {
    throw agreementError;
  }

  const agreementId = agreement?.id;
  if (typeof agreementId !== "string") {
    throw new Error("Booking agreement not found.");
  }

  const { data: version, error: versionError } =
    await supabaseAdmin
      .from("agreement_versions")
      .select("final_document_path")
      .eq("agreement_id", agreementId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

  if (versionError) {
    throw versionError;
  }

  const finalDocumentPath = version?.final_document_path;
  if (typeof finalDocumentPath !== "string") {
    throw new Error("Signed contract PDF was not found.");
  }

  const { data: pdf, error: downloadError } =
    await supabaseAdmin.storage
      .from("agreements")
      .download(finalDocumentPath);

  if (downloadError || !pdf) {
    throw (
      downloadError ||
      new Error("Could not download signed contract PDF.")
    );
  }

  const filename =
    `signed-rental-agreement-${bookingReference
      .replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`;

  /*
   * Convert the PDF ArrayBuffer to Base64.
   *
   * Buffer is not used because this is a Deno/Supabase Edge Function.
   */
  const bytes = new Uint8Array(await pdf.arrayBuffer());

  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(
      i,
      Math.min(i + chunkSize, bytes.length),
    );

    binary += String.fromCharCode(...chunk);
  }

  const base64Content = btoa(binary);

  return {
    filename,
    content: base64Content,
    contentType: "application/pdf",
    encoding: "base64" as const,
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getEmailContent(
  emailType: string,
  recipientName: string,
  bookingReference: string,
  stage: string,
  rejectionReason = "",
) {
  let title = "Booking Update";
  let message = "There has been an update to your booking.";

  switch (emailType) {
    case "payment_verified":
      if (stage === "down_payment") {
        title = "Down Payment Verified";
        message =
          "Your down payment has been successfully verified.";
      } else if (stage === "balance") {
        title = "Balance Payment Verified";
        message =
          "Your balance payment has been successfully verified.";
      } else {
        title = "Payment Verified";
        message =
          "Your payment has been successfully verified.";
      }
      break;

    case "booking_pending":
      title = "Booking Received";
      message =
        "We have received your booking request and it is currently being reviewed.";
      break;

    case "booking_approved":
      title = "Booking Approved";
      message =
        "Good news! Your booking has been approved.";
      break;

    case "booking_confirmed":
      title = "Booking Confirmed";
      message =
        "Your booking has been confirmed.";
      break;

    case "booking_ready":
      title = "Your Rental Is Ready";
      message =
        "Your rental is ready for release. Please check your booking details for the scheduled release information.";
      break;

    case "booking_released":
      title = "Rental Released";
      message =
        "Your rental has been successfully released.";
      break;

    case "booking_returned":
      title = "Rental Returned";
      message =
        "Your rental has been successfully returned. Thank you for choosing Maddy & Cassy Rentals!";
      break;

    case "booking_cancelled":
      title = "Booking Cancelled";
      message =
        "Your booking has been cancelled. Please check your account for more details.";
      break;

    case "booking_rejected":
      title = "Booking Update";
      message =
        "Unfortunately, your booking was not approved. Please check your account for additional details.";
      break;

    case "payment_rejected":
      title = "Payment Proof Rejected";
      message =
        `Your payment proof for booking ${bookingReference} has been rejected. Please review the reason below and submit a new payment proof.${rejectionReason ? ` Rejection reason: ${rejectionReason}` : ""}`;
      break;

    case "booking_confirmation_contract":
      title = "Booking Confirmation & Signed Contract";
      message =
        "Your booking has been confirmed. Your signed rental contract is attached to this email.";
      break;

    default:
      title = "Booking Update";
      message =
        "There has been an update to your Maddy & Cassy Rentals booking.";
  }

  return {
    title,
    message,
  };
}

function createHtmlEmail(
  emailType: string,
  recipientName: string,
  bookingReference: string,
  stage: string,
  rejectionReason = "",
  bookingUrl = "",
) {
  const { title, message } = getEmailContent(
    emailType,
    recipientName,
    bookingReference,
    stage,
    rejectionReason,
  );

  const safeName = escapeHtml(recipientName || "Customer");

  const safeBookingReference = escapeHtml(
    bookingReference || "N/A",
  );

  const isContractEmail =
    emailType === "booking_confirmation_contract";
  const isPaymentRejectionEmail = emailType === "payment_rejected";
  const safeRejectionReason = escapeHtml(
    rejectionReason || "Please submit a clear, valid payment proof.",
  );
  const safeBookingUrl = escapeHtml(bookingUrl);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >
  <title>${escapeHtml(title)}</title>
</head>

<body
  style="
    margin:0;
    padding:0;
    background:#f5f5f5;
    font-family:Arial,Helvetica,sans-serif;
  "
>

  <div
    style="
      max-width:600px;
      margin:40px auto;
      background:#ffffff;
      border-radius:12px;
      overflow:hidden;
      border:1px solid #eeeeee;
    "
  >

    <!-- Header -->
    <div
      style="
        padding:28px 24px;
        text-align:center;
        background:#ffffff;
        border-bottom:1px solid #eeeeee;
      "
    >
      <h1
        style="
          margin:0;
          font-size:24px;
          color:#222222;
        "
      >
        Maddy &amp; Cassy Rentals
      </h1>
    </div>

    <!-- Content -->
    <div style="padding:32px 28px;">

      <h2
        style="
          margin:0 0 20px;
          color:#222222;
          font-size:22px;
        "
      >
        ${escapeHtml(title)}
      </h2>

      <p
        style="
          font-size:16px;
          color:#444444;
          margin:0 0 15px;
        "
      >
        Hi ${safeName},
      </p>

      <p
        style="
          font-size:16px;
          line-height:1.6;
          color:#444444;
        "
      >
        ${escapeHtml(message)}
      </p>

      <!-- Booking Reference -->
      <div
        style="
          margin:25px 0;
          padding:18px;
          background:#f8f8f8;
          border-radius:8px;
        "
      >
        <p
          style="
            margin:0;
            font-size:15px;
            color:#444444;
          "
        >
          <strong>Booking Reference:</strong>
          ${safeBookingReference}
        </p>
      </div>

      ${
        isPaymentRejectionEmail
          ? `
      <div
        style="
          margin:25px 0;
          padding:18px;
          background:#fffaf8;
          border:1px solid #f0e4e0;
          border-radius:8px;
        "
      >
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9d5967">
          Rejection Reason
        </p>
        <p style="margin:0;font-size:15px;line-height:1.6;color:#444444">
          ${safeRejectionReason}
        </p>
      </div>
      `
          : ""
      }

      ${
        isContractEmail
          ? `
      <div
        style="
          margin:25px 0;
          padding:18px;
          background:#f8f8f8;
          border-radius:8px;
        "
      >
        <p
          style="
            margin:0;
            font-size:15px;
            line-height:1.6;
            color:#444444;
          "
        >
          Your signed rental agreement is attached to this email.
          Please keep a copy of the contract for your records.
        </p>
      </div>
      `
          : ""
      }

      ${
        isPaymentRejectionEmail
          ? `
      <p style="font-size:15px;line-height:1.6;color:#555555">
        Please correct the issue above and submit a new payment proof from your booking page. We will review the updated proof as soon as possible.
      </p>
      <p style="margin:24px 0 0">
        <a href="${safeBookingUrl}" style="display:inline-block;background:#a75e6d;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:14px 22px;border-radius:8px">Resubmit Payment</a>
      </p>
      `
          : `
      <p
        style="
          font-size:15px;
          line-height:1.6;
          color:#555555;
        "
      >
        Please log in to your Maddy &amp; Cassy Rentals account
        to view your complete booking details.
      </p>

      <p
        style="
          margin-top:28px;
          font-size:15px;
          color:#555555;
        "
      >
        Thank you for choosing Maddy &amp; Cassy Rentals!
      </p>
      `
      }

    </div>

    <!-- Footer -->
    <div
      style="
        padding:18px;
        text-align:center;
        background:#fafafa;
        color:#888888;
        font-size:12px;
      "
    >
      This is an automated email from Maddy &amp; Cassy Rentals.
    </div>

  </div>

</body>
</html>
`;
}

export default {
  fetch: withSupabase(
    { auth: "secret" },
    async (req, ctx) => {
      let claimedEmailId: string | null = null;
      try {
        /*
         * Only POST requests are allowed.
         */
        if (req.method !== "POST") {
          return Response.json(
            {
              success: false,
              error: "Only POST requests are allowed.",
            },
            { status: 405 },
          );
        }

        const requestBody = await req.json().catch(() => ({}));

        const eventKey = typeof requestBody.eventKey === "string" && requestBody.eventKey.trim()
          ? requestBody.eventKey.trim()
          : null;
        console.info("Booking email function invoked", {
          source: "edge.send-booking-emails",
          eventKey,
          requestedTo: typeof requestBody.to === "string" ? requestBody.to : null,
        });
        const leaseCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

        // First resolve the requested event. This makes a retried app request or
        // a duplicate database webhook address the same queue row instead of
        // consuming whichever email happens to be oldest.
        let existingEmail = null;
        if (eventKey) {
          const { data, error } = await ctx.supabaseAdmin
            .from("email_notifications")
            .select("*")
            .eq("event_key", eventKey)
            .maybeSingle();
          if (error) throw error;
          existingEmail = data;
          if (existingEmail?.status === "sent") {
            console.info("Booking email duplicate suppressed", {
              source: "edge.send-booking-emails",
              eventKey,
              queueId: existingEmail.id,
              status: existingEmail.status,
            });
            return Response.json({
              success: true,
              duplicate: true,
              message: "Email event already sent.",
              email_id: existingEmail.id,
            });
          }
        }

        // claimed_at is a short lease. The conditional update is the atomic
        // claim: concurrent function invocations can both read a pending row,
        // but only one can update it while its lease is available.
        const candidateQuery = ctx.supabaseAdmin
          .from("email_notifications")
          .update({ claimed_at: new Date().toISOString() })
          .eq("status", "pending")
          .or(`claimed_at.is.null,claimed_at.lt.${leaseCutoff}`);
        const { data: claimedRows, error: claimError } = await (eventKey
          ? candidateQuery.eq("event_key", eventKey)
          : candidateQuery.order("created_at", { ascending: true }).limit(1))
          .select("*")
          .limit(1);
        if (claimError) throw claimError;
        const email = claimedRows?.[0] ?? null;

        if (!email) {
          console.info("Booking email invocation found no claimable event", {
            source: "edge.send-booking-emails",
            eventKey,
            requestedQueueId: existingEmail?.id ?? null,
          });
          return Response.json({
            success: true,
            duplicate: Boolean(existingEmail),
            message: existingEmail ? "Email event is already being processed." : "No pending emails.",
          });
        }

        claimedEmailId = email.id;

        console.info("Booking email event claimed", {
          source: "edge.send-booking-emails",
          eventKey: email.event_key,
          queueId: email.id,
          emailType: email.email_type,
          attempt: email.attempt_count,
        });

        /*
         * No pending email.
         */
        if (!email) {
          return Response.json({
            success: true,
            message: "No pending emails.",
          });
        }

        /*
         * Get booking information.
         */
        let bookingReference = "";
        let stage = "";
        let rejectionReason = "";
        let bookingUrl = "";

        if (email.booking_id) {
          const { data: booking, error: bookingError } =
            await ctx.supabaseAdmin
              .from("bookings")
              .select("booking_reference, is_guest_checkout")
              .eq("id", email.booking_id)
              .maybeSingle();

          if (bookingError) {
            throw bookingError;
          }

          bookingReference =
            booking?.booking_reference || "";

          if (email.email_type === "payment_rejected") {
            if (!booking) {
              throw new Error("Booking is missing for the payment rejection email.");
            }
            const {
              data: payment,
              error: paymentError,
            } = await ctx.supabaseAdmin
              .from("booking_payment_submissions")
              .select("review_notes")
              .eq("booking_id", email.booking_id)
              .eq("status", "rejected")
              .order("reviewed_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (paymentError) {
              throw paymentError;
            }

            rejectionReason = payment?.review_notes || "";
            bookingUrl = paymentRejectionBookingUrl(email.booking_id, booking.is_guest_checkout === true);
          }

          /*
           * For payment verification emails,
           * determine the payment stage.
           */
          if (email.email_type === "payment_verified") {
            const {
              data: payment,
              error: paymentError,
            } = await ctx.supabaseAdmin
              .from("booking_payment_submissions")
              .select("stage")
              .eq("booking_id", email.booking_id)
              .eq("status", "verified")
              .order("reviewed_at", {
                ascending: false,
              })
              .limit(1)
              .maybeSingle();

            if (paymentError) {
              throw paymentError;
            }

            stage = payment?.stage || "";
          }
        }

        /*
         * Create the HTML email.
         */
        const generatedHtml = createHtmlEmail(
          email.email_type,
          email.recipient_name || "Customer",
          bookingReference,
          stage,
          rejectionReason,
          bookingUrl,
        );
        const html =
          email.email_type === "payment_rejected" &&
          typeof requestBody.html === "string" &&
          requestBody.html.trim()
            ? requestBody.html
            : generatedHtml;
        const generatedText =
          `${email.subject}\n\n` +
          `Hi ${email.recipient_name || "Customer"},\n\n` +
          `${getEmailContent(
            email.email_type,
            email.recipient_name || "Customer",
            bookingReference,
            stage,
            rejectionReason,
          ).message}\n\n` +
          `Booking Reference: ${bookingReference}\n\n` +
          `${
            email.email_type === "payment_rejected"
              ? `Rejection Reason: ${rejectionReason || "Please submit a clear, valid payment proof."}\n\nPlease correct the issue above and submit a new payment proof: ${bookingUrl}\n\n`
              : ""
          }` +
          `${
            email.email_type === "booking_confirmation_contract"
              ? "Your signed rental agreement is attached to this email.\n\n"
              : ""
          }` +
          "Thank you for choosing Maddy & Cassy Rentals.";
        const text =
          email.email_type === "payment_rejected" &&
          typeof requestBody.text === "string" &&
          requestBody.text.trim()
            ? requestBody.text
            : generatedText;

        /*
         * Create Gmail SMTP transporter.
         */
        const transporter =
          nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_PORT === 465,
            auth: {
              user: SMTP_USER,
              pass: SMTP_PASSWORD,
            },
          });

        /*
         * Prepare attachments.
         */
        const attachments: Array<{
          filename: string;
          content: string;
          contentType: string;
          encoding: "base64";
        }> = [];

        /*
         * Attach the signed rental contract
         * for booking confirmation emails.
         */
        if (
          email.email_type ===
          "booking_confirmation_contract"
        ) {
          if (!email.booking_id) {
            throw new Error(
              "Booking ID is missing for confirmation email.",
            );
          }

          const contractAttachment =
            await getContractAttachment(
              ctx.supabaseAdmin,
              email.booking_id,
              bookingReference,
            );

          attachments.push(contractAttachment);
        }

        /*
         * Send the email.
         */
        await transporter.sendMail({
          from: `"${FROM_NAME}" <${SMTP_USER}>`,
          to: email.recipient_email,
          subject: email.subject,
          html,

          text,

          /*
           * This is what actually attaches the PDF.
           */
          attachments,
        });

        /*
         * Mark email as successfully sent.
         */
        const { error: updateError } =
          await ctx.supabaseAdmin
            .from("email_notifications")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              error_message: null,
              claimed_at: null,
            })
            .eq("id", email.id);

        if (updateError) {
          throw updateError;
        }

        /*
         * Return success.
         */
        return Response.json({
          success: true,
          message: "Email sent successfully.",
          email_id: email.id,
          recipient: email.recipient_email,
        });

      } catch (error) {
        if (claimedEmailId) {
          const { error: releaseError } = await ctx.supabaseAdmin
            .from("email_notifications")
            .update({ claimed_at: null, error_message: error instanceof Error ? error.message : String(error) })
            .eq("id", claimedEmailId)
            .eq("status", "pending");
          if (releaseError) {
            console.error("Booking email claim release failed", {
              source: "edge.send-booking-emails",
              queueId: claimedEmailId,
              error: releaseError,
            });
          }
        }
        console.error(
          "Email sending error:",
          error,
        );

        return Response.json(
          {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : String(error),
          },
          { status: 500 },
        );
      }
    },
  ),
};
