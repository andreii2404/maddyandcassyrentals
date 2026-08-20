# Production operations

## GoDaddy VPS deployment

This application requires a Node.js-capable VPS; it is not a static shared-hosting
upload. On an Ubuntu GoDaddy VPS:

1. Install Node.js 20+, Nginx, PM2, and Certbot.
2. Copy the repository and a production `.env` file to the server.
3. Run `npm ci`, `npm run build`, then `pm2 start ecosystem.config.cjs`.
4. Adapt `ops/nginx-godaddy.conf` to the real domain and enable it in Nginx.
5. Issue a TLS certificate with Certbot and point the GoDaddy DNS A record to
   the VPS.

Use Cloudflare proxying in front of the VPS for managed WAF, bot protection,
DDoS mitigation, and CDN caching. Never cache `/api/*`, `/account/*`, or
`/admin/*`.

## Required secrets

Start from `.env.example`. Keep the Supabase service-role key and Web Push
VAPID private key in the VPS secret environment only — never commit them or
expose them to the browser.

## Supabase production setup

- Project: `Rental by Maddy & Cassy` (ref `nyyjzgpaysuaaqjyibmi`).
- Schema is managed through `maddy_cassy_supabase_schema.sql` plus the
  migrations under `supabase/migrations/`. Apply new migrations with the
  Supabase CLI or dashboard SQL editor in the order they were created.
- Row Level Security is enabled on every exposed table; do not disable it.
- Rotate `SUPABASE_SECRET_KEY` (service role) from Project Settings > API if
  it is ever exposed, and update the VPS secret environment immediately.
- Run the Supabase security and performance advisors after every schema
  change (Dashboard > Advisors, or the `get_advisors` MCP tool).

## Web Push (VAPID)

- Generate a production key pair once with
  `node -e "console.log(require('web-push').generateVAPIDKeys())"` and store
  the private key only in the server environment.
- `public/push-sw.js` is the service worker; no separate messaging config is
  required (this replaces the old Firebase Cloud Messaging setup).

## Backups

Use Supabase's built-in Point-in-Time Recovery (paid plans) or scheduled
`pg_dump` exports of the project database, stored in a private, versioned
bucket in a different region/account. Configure retention and test a restore
quarterly. Storage buckets (`booking-documents`, `agreements`, `receipts`,
etc.) should be included in the same backup schedule.

## Monitoring and alerts

- Monitor `GET /api/health` every minute from an external HTTPS monitor.
- Alert on HTTP 5xx rates and Supabase quota/permission errors (Dashboard >
  Logs).
- Watch for `booking_payment_submissions` rows stuck in `submitted` or
  `under_review` for longer than expected — that's a customer waiting on a
  manual GCash review.
- Forward structured logs without request bodies, ID images, tokens, or
  secrets.
- Configure disk, memory, certificate-expiry, and PM2 restart alerts.
- Review `/admin/payments` and `/admin/audit` during daily reconciliation.
