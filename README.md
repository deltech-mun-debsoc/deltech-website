# MUN Platform

Conference management platform for Model United Nations events — registrations, delegate management, committee workflows, article publishing, and payments.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, TypeScript) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Auth | NextAuth v5 (beta) + Resend magic-link |
| ORM | Prisma + PostgreSQL (Supabase) |
| Storage | S3 (presigned uploads) |
| Payments | Razorpay (card / UPI) |
| Email | Resend + React Email |
| Rich text | Tiptap |
| Animations | Framer Motion |

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Set environment variables
cp .env.example .env
# Fill in all values in .env

# 3. Generate the Prisma client
npm run db:generate

# 4. Run database migrations
npm run db:migrate

# 5. Seed the database
npm run db:seed

# 6. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## UI text

All user-visible strings live in `src/content/strings.ts`. Never hardcode text literals in components. `scripts/check-strings.mjs` enforces this, plus a ban on em dashes under `src/`. It runs in `npm run check` and in CI.

## Design tokens

All design values live in `src/app/globals.css`. Tailwind v4 is configured in CSS: there is no `tailwind.config.ts` and no `src/styles/tokens.ts`. See `docs/DESIGN_TOKENS.md`.

## Supabase environment variables

Find these values in your Supabase project dashboard:

| Env var | Where to find it | Purpose |
|---|---|---|
| `DATABASE_URL` | Settings → Database → Connection string → **Transaction** (Session mode) — append `?pgbouncer=true` | App runtime (pooled via pgBouncer) |
| `DIRECT_URL` | Settings → Database → Connection string → **Direct** | Prisma migrations (bypasses pgBouncer) |

> `DATABASE_URL` must include `?pgbouncer=true` (and optionally `&connection_limit=1` in edge environments).

## Resend domain verification (deltechmun.in)

Add these DNS records to verify the sending domain in the [Resend dashboard](https://resend.com/domains):

| Type | Name | Value |
|------|------|-------|
| TXT | `resend._domainkey.deltechmun.in` | Provided in the Resend dashboard after adding the domain |
| TXT | `deltechmun.in` | `v=spf1 include:amazonses.com ~all` (or as provided by Resend) |
| CNAME | `em.<unique>.deltechmun.in` | Provided in the Resend dashboard |

> After adding the records, click **Verify** in the Resend dashboard. Propagation typically takes up to 72 h but is usually instant via Cloudflare.

Set `EMAIL_FROM=noreply@deltechmun.in` in your environment once verification completes.

## Docs

The full documentation site is at [docs.deltechmun.in](https://docs.deltechmun.in), served
from the `(docs)` route group in this app. Source: `src/app/(docs)/`.

`docs/` in this repository holds internal engineering material (spec, plan of action, CI
notes, maintainer guide). Read `docs/README.md` at the start of every session.
