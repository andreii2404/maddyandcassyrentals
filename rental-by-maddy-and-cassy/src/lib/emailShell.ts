export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

export function formatPeso(value: number): string {
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatManilaDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Two-column label/value rows. Values may contain newlines. Rows without a value are skipped. */
export function renderSummaryTable(rows: [string, string | undefined][]): string {
  const visible = rows.filter((row): row is [string, string] => Boolean(row[1]));
  if (!visible.length) return "";
  const body = visible
    .map(
      ([label, value]) =>
        `<tr><td valign="top" style="padding:7px 12px 7px 0;color:#8b7d80;font-size:12px;font-weight:700;letter-spacing:.8px;text-transform:uppercase">${escapeHtml(label)}</td><td align="right" style="padding:7px 0;color:#292425;font-size:14px;font-weight:700">${escapeHtml(value).replaceAll("\n", "<br>")}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffaf8;border:1px solid #f0e4e0;border-radius:16px"><tr><td style="padding:14px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></td></tr></table>`;
}

interface EmailShellInput {
  preheader: string;
  eyebrow: string;
  heading: string;
  /** Already-escaped HTML. */
  introHtml: string;
  /** Already-escaped HTML placed between the intro and the button. */
  bodyHtml: string;
  buttonLabel: string;
  buttonUrl: string;
  footerReference: string;
}

export function renderEmailShell(input: EmailShellInput): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f7f2f0;color:#252122;font-family:Arial,Helvetica,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f2f0;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #eadedb;border-radius:24px;overflow:hidden">
          <tr><td style="background:#985766;padding:26px 34px;color:#ffffff">
            <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.82">Rental by</div>
            <div style="margin-top:4px;font-size:24px;font-weight:800">Maddy &amp; Cassy</div>
          </td></tr>
          <tr><td style="padding:36px 34px 16px">
            <div style="color:#a45c6b;font-size:12px;font-weight:800;letter-spacing:1.5px">${escapeHtml(input.eyebrow)}</div>
            <h1 style="margin:10px 0 14px;font-size:30px;line-height:1.15;color:#211d1e">${input.heading}</h1>
            <p style="margin:0;color:#5d5557;font-size:16px;line-height:1.7">${input.introHtml}</p>
          </td></tr>
          <tr><td style="padding:12px 34px 16px">${input.bodyHtml}</td></tr>
          <tr><td style="padding:8px 34px 34px">
            <a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;background:#a75e6d;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:14px 22px;border-radius:12px">${escapeHtml(input.buttonLabel)}</a>
          </td></tr>
          <tr><td style="border-top:1px solid #efe5e2;padding:22px 34px;color:#8b7d80;font-size:12px;line-height:1.6">
            This message is about booking ${escapeHtml(input.footerReference)}. If you need help, reply to this email or contact Rental by Maddy &amp; Cassy.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
