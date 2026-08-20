This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Supabase access

Server-side operations such as deleting a customer account, generating
private PDFs, and reviewing manually submitted GCash payments use the
Supabase service-role key. Set `SUPABASE_SECRET_KEY` in the local or hosting
environment (see `.env.local.example`).

Never commit this key or expose it to the browser — only
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are
safe for client code.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Payments, documents, and notifications

Customers pay manually via GCash: they submit a reference number, the paying
account's name/number, and a screenshot of the transfer as proof of payment.
An administrator reviews the submission in `/admin/bookings/[id]` and marks it
verified or rejected — verification is the source of truth, not any
automated provider callback. The system privately generates invoices,
official receipts, verified payment proof, and a two-page final rental
agreement once a payment is verified.

Web Push notifications are available from the customer profile after
`NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY` and `WEB_PUSH_VAPID_PRIVATE_KEY` are
configured (generate a pair with
`node -e "console.log(require('web-push').generateVAPIDKeys())"`).

## Customer sign-in

Customers sign in and create accounts with a six-digit email OTP —
`supabase.auth.signInWithOtp` sends the code and `supabase.auth.verifyOtp`
confirms it, so no separate email provider configuration is required beyond
the Supabase project's own email settings.

## Verification

Run `npm run verify` to lint, type-check, test PDF generation, and build the
production application.

## GoDaddy production deployment

The project builds as a standalone Node.js service for a GoDaddy VPS. It cannot
run on static shared hosting. PM2, Nginx/TLS, Cloudflare WAF/CDN, backups, and
monitoring are documented in `ops/PRODUCTION.md`.
