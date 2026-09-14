# DelTech MUN Platform — Step-by-Step Build POA

Execution plan for building from an empty folder to deployed, on the finalized free-tier stack. Each phase has concrete steps. Hand me one phase per session.

**Final stack:** Next.js 16 (App Router, Turbopack default, React 19.2, `proxy` not `middleware`, async `params`) · TypeScript (ESM, `"type":"module"`) · **Prisma 7** (driver-adapter required, `prisma-client` generator, `prisma.config.ts`) + Postgres · S3 · NextAuth v5 (Auth.js) · Resend · Tiptap · Framer Motion · Tailwind + shadcn/ui · SSE realtime (quiz only) · Razorpay **or** UPI-QR (pluggable).

> **Stack notes that change syntax everywhere:**
> - **Next 16:** Turbopack is the default bundler. `middleware.ts` is renamed to **`proxy.ts`** (export `proxy`, Node runtime only). `params`/`searchParams` are **async** (`await props.params`). Use `next typegen` for `PageProps<'/route'>` types. Node 20.19+.
> - **Prisma 7:** Rust-free, ESM-only. The datasource **URL lives in `prisma.config.ts`, not `schema.prisma`**. Generator is **`prisma-client`** (not `prisma-client-js`) with a required **`output`** path. A **driver adapter is mandatory** — `new PrismaClient()` with no adapter throws. Import `PrismaClient` from the **generated path**, not `@prisma/client`. Env is **not auto-loaded** (`import "dotenv/config"`).
**Rejected (kept out):** tRPC, Redis, BullMQ, Clerk.
**Hosting:** AWS Lightsail (app + private Postgres) · S3 (media/backups) · Resend/SES (email) · Razorpay or UPI (payments).

---

## Core architecture decisions (these shape everything)

1. **Allot-then-pay.** Registration is free. Admin allots → payment link is generated → delegate pays → confirmed. No checkout at registration time.
2. **Nothing hardcoded.** All copy, fees, committees, portfolios, dates, and the registration open/close switch live in the DB and are edited from the dashboard. A typed `contentSchema.ts` defines the *shape* + safe defaults; the *values* live in a `Setting` table. Code never contains a fee, a date, or a block of public copy.
3. **One simple admin role.** `User.role = ADMIN | AUTHOR`. 2–3 admins. No permission matrix.
4. **Pluggable payments.** A `PaymentProvider` interface with two implementations (`razorpay`, `upi_qr`); the active one is a setting. Switching rails = changing a dropdown, not code.
5. **Flexible cross-del import.** Admin uploads any Excel/CSV → maps *their* columns to our fields in the UI → preview → validate → commit. Handles "may or may not be in a format."
6. **Delegates are email-keyed.** A delegate record is identified by email. Login (magic link) is optional per your answer to Q3; the system works email-only if you prefer.

---

## Phase 0 — Repo creation & local setup

**0.1 Scaffold (Next 16 latest, Turbopack default).**
```bash
npx create-next-app@latest deltech-mun --typescript --tailwind --app --src-dir --import-alias "@/*" --use-npm
cd deltech-mun
# Prisma 7 requires ESM:
npm pkg set type="module"
git init && git add -A && git commit -m "chore: scaffold next 16"
```

**0.2 Install dependencies.**
```bash
# data + auth (Prisma 7 needs the pg driver adapter + dotenv + tsx for seeding)
npm i @prisma/client @prisma/adapter-pg pg next-auth@beta @auth/prisma-adapter zod dotenv
npm i -D prisma tsx @types/pg
# email
npm i resend react-email @react-email/components
# editor + motion
npm i @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder \
      @tiptap/extension-image @tiptap/extension-link @tiptap/extension-typography \
      @tiptap/extension-character-count framer-motion
# realtime (quiz only) + excel + qr
npm i xlsx qrcode.react
# ui helpers
npm i lucide-react class-variance-authority clsx tailwind-merge sonner
```

**0.3 shadcn/ui init — install the FULL component set (shadcn-only policy).**
```bash
npx shadcn@latest init
npx shadcn@latest add button input textarea select checkbox radio-group switch \
  label form dialog drawer sheet popover dropdown-menu command tooltip hover-card \
  calendar date-picker table tabs accordion badge card alert alert-dialog toast sonner \
  skeleton avatar separator progress slider scroll-area breadcrumb pagination \
  navigation-menu sidebar combobox toggle toggle-group collapsible carousel chart
```
> **Binding UI rule (applies to every later day):** use **shadcn/ui components only** — never raw HTML form controls. No bare `<input>`, `<select>`, `<textarea>`, `<button>`, `<input type="date">`, `<input type="checkbox">`, or native date/time pickers (they look inconsistent and ugly across browsers). Always use the shadcn equivalent: `Input`, `Select`, `Textarea`, `Button`, `Calendar`/`DatePicker` (in a `Popover`), `Checkbox`, `RadioGroup`, `Switch`, `Combobox` (for searchable selects like committee/portfolio), `Command` (for palettes/search), `Dialog`/`Sheet`/`Drawer` for overlays, `Toast`/`Sonner` for notifications. If a needed primitive isn't installed, `npx shadcn@latest add <name>` first — do not fall back to native HTML. The native date input in particular is forbidden; use shadcn `Calendar` inside a `Popover` (the DatePicker pattern).

**0.4 Folder structure to create.**
```
src/
  app/
    (public)/            # landing, blog read, register, availability board, quiz join
    (admin)/admin/       # dashboard (auth-gated)
    (author)/write/      # blog editor (magic-link gated)
    api/
      auth/[...nextauth]/route.ts
      webhooks/razorpay/route.ts
  components/ui/          # shadcn
  components/             # app components
  generated/prisma/       # Prisma 7 client output (generated, gitignored)
  lib/
    prisma.ts             # PrismaClient + PrismaPg adapter (singleton)
    auth.ts               # NextAuth config
    resend.ts
    payments/             # provider interface + razorpay + upi
    settings.ts           # getSetting()/getContent() helpers (cached)
  content/
    contentSchema.ts      # zod schema + DEFAULTS for all dynamic copy/config
  emails/                 # react-email templates
prisma/
  schema.prisma           # models only (NO url here in Prisma 7)
proxy.ts                  # Next 16 (replaces middleware.ts)
prisma.config.ts          # Prisma 7 config (datasource url, migrations, seed)
```

**0.5 Database + env.**
- Start Postgres (a local Docker container, or a box per docs/AWS.md). Set DATABASE_URL and DIRECT_URL.
- `.env`:
```
DATABASE_URL="postgresql://...pooler...?pgbouncer=true"   # app runtime (pooled, used by the pg adapter)
DIRECT_URL="postgresql://...direct..."                    # migrations (used by prisma.config.ts)
AUTH_SECRET="..."          # npx auth secret
AUTH_RESEND_KEY="re_..."
EMAIL_FROM="noreply@deltechmun.in"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
RAZORPAY_KEY_ID="" RAZORPAY_KEY_SECRET="" RAZORPAY_WEBHOOK_SECRET=""
UPI_VPA="yourname@upi" UPI_PAYEE_NAME="DelTech MUN"
ADMIN_EMAIL="you@email.com"
```

**0.6 Prisma 7 config + schema generator (NEW syntax — this is the big v7 change).**

`prisma.config.ts` (project root — replaces the old datasource-in-schema setup):
```ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  // CLI/migrations use the DIRECT connection:
  datasource: { url: env("DIRECT_URL") },
});
```

`prisma/schema.prisma` top (models added Phase 1) — **generator `prisma-client` + output, datasource has provider only, no url:**
```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}
datasource db {
  provider = "postgresql"
}
```

`src/lib/prisma.ts` — **driver adapter is mandatory in v7; import from the generated path:**
```ts
import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const pool = new Pool({ connectionString: process.env.DATABASE_URL }); // pooled at runtime
const adapter = new PrismaPg(pool);
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

`next.config.ts` — keep Prisma's generated client external so Turbopack resolves it during SSR:
```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = { serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg"] };
export default nextConfig;
```

Add `src/generated/` to `.gitignore`. Add scripts to package.json: `"db:generate":"prisma generate"`, `"db:migrate":"prisma migrate dev"`, `"db:seed":"prisma db seed"`.

**Exit criteria:** `npm run dev` (Turbopack) serves a styled page; `prisma generate` outputs to `src/generated/prisma`; `prisma migrate dev` connects to Postgres via `prisma.config.ts`; importing `prisma` from `@/lib/prisma` works in a server component.

---

## Phase 1 — Data model + dynamic content layer

**1.1 Prisma schema (core).** Add the models below to `schema.prisma` (the `generator`/`datasource` blocks from Phase 0.6 stay at the top — generator `prisma-client` with `output`, datasource with `provider` only, **no url**):
```prisma
// ---- Auth (NextAuth needs these) ----
model User { id String @id @default(cuid()) email String @unique
  name String? role Role @default(AUTHOR) emailVerified DateTime?
  accounts Account[] sessions Session[] posts Post[] }
enum Role { ADMIN AUTHOR }
// + Account, Session, VerificationToken models per @auth/prisma-adapter

// ---- Conference config (all editable from dashboard) ----
model Setting { key String @id  value Json  updatedAt DateTime @updatedAt }
model Committee { id String @id @default(cuid()) name String slug String @unique
  agenda String? type CommitteeType @default(STANDARD)
  doubleDelegation Boolean @default(false) ebMembers Json? isActive Boolean @default(true)
  sortOrder Int @default(0) portfolios Portfolio[] }
enum CommitteeType { STANDARD CRISIS PRESS }
model Portfolio { id String @id @default(cuid()) committeeId String
  committee Committee @relation(fields:[committeeId], references:[id])
  name String                  // country OR figure OR journalist role
  status PortfolioStatus @default(AVAILABLE)
  allotmentId String? @unique
  @@unique([committeeId, name]) }
enum PortfolioStatus { AVAILABLE ON_HOLD ALLOTTED BLOCKED }
model Fee { id String @id @default(cuid()) label String
  committeeType String isDtu Boolean @default(false) amountInr Int }

// ---- Registrations ----
model Delegate { id String @id @default(cuid())
  fullName String email String whatsapp String altPhone String?
  institution String isDtu Boolean @default(false) munExperience String?
  source Source @default(SELF) sourceNote String?
  pref1CommitteeId String? pref1Portfolio String?
  pref2CommitteeId String? pref2Portfolio String?
  needsAccommodation Boolean @default(false) outsideNcr Boolean @default(false)
  reference String? status AppStatus @default(REGISTERED)
  coDelegate CoDelegate? allotment Allotment? payment Payment?
  createdAt DateTime @default(now()) }
enum Source { SELF CROSS_DEL SPONSORED INTERNAL MANUAL }
enum AppStatus { REGISTERED ALLOTTED PAYMENT_SENT PAID CONFIRMED CANCELLED WAITLISTED }
model CoDelegate { id String @id @default(cuid()) delegateId String @unique
  delegate Delegate @relation(fields:[delegateId], references:[id])
  fullName String email String phone String institution String? munExperience String? }
model Allotment { id String @id @default(cuid()) delegateId String @unique
  delegate Delegate @relation(fields:[delegateId], references:[id])
  committeeId String portfolioId String @unique
  allottedAt DateTime @default(now()) allottedBy String emailSentAt DateTime? }

// ---- Payments ----
model Payment { id String @id @default(cuid()) delegateId String @unique
  delegate Delegate @relation(fields:[delegateId], references:[id])
  provider String amountInr Int status PayStatus @default(PENDING)
  razorpayOrderId String? razorpayPaymentId String? paymentLink String?
  method String? confirmedAt DateTime? createdAt DateTime @default(now()) }
enum PayStatus { PENDING SENT PAID FAILED COMPED OFFLINE }

// ---- Blog ----
model Post { id String @id @default(cuid()) authorId String
  author User @relation(fields:[authorId], references:[id])
  title String subtitle String? slug String @unique coverImage String?
  contentJson Json status PostStatus @default(DRAFT) readMin Int?
  tags String[] reviewNote String? submittedAt DateTime? publishedAt DateTime? }
enum PostStatus { DRAFT PENDING CHANGES_REQUESTED PUBLISHED REJECTED }

// ---- Quiz ----
model Presentation { id String @id @default(cuid()) ownerId String title String
  theme Json? mode QuizMode @default(POLL) slides Slide[] createdAt DateTime @default(now()) }
enum QuizMode { POLL QUIZ }
model Slide { id String @id @default(cuid()) presentationId String
  presentation Presentation @relation(fields:[presentationId], references:[id])
  order Int type SlideType prompt String config Json }
enum SlideType { MCQ WORDCLOUD SCALE OPEN_TEXT CONTENT }
model QuizSession { id String @id @default(cuid()) presentationId String
  roomCode String @unique status String @default("lobby") currentSlideId String?
  startedAt DateTime? endedAt DateTime? }
model Response { id String @id @default(cuid()) sessionId String slideId String
  nickname String? answer Json points Int @default(0) createdAt DateTime @default(now())
  @@index([sessionId, slideId]) }
```
```bash
# Prisma 7: config-driven; generate outputs to src/generated/prisma
npx prisma migrate dev --name init
npx prisma generate
# (seed defined in prisma.config.ts → `npx prisma db seed` runs tsx prisma/seed.ts)
```
> Prisma 7 reminders: import the client from `@/generated/prisma/client`, always pass the `PrismaPg` adapter (`new PrismaClient({ adapter })` — bare `new PrismaClient()` throws), and start seed/scripts with `import "dotenv/config"` (env is not auto-loaded).

**1.2 Dynamic content layer.**
- `content/contentSchema.ts`: a Zod schema describing every editable piece — `registrationOpen: boolean`, `conferenceDates: string`, `venue`, `landingHero`, `agendasBlurb`, `awards`, `queryContacts`, `paymentProvider: 'razorpay'|'upi_qr'`, `accommodationNote`, etc. — each with a default value.
- `lib/settings.ts`: `getContent()` reads the `Setting` table, merges over schema defaults, validates with Zod, caches per request. `setContent(partial)` writes back (admin only). Result: every public string and toggle is DB-driven with type safety and a guaranteed fallback.
- **Registration open/close** is just `content.registrationOpen` — the public form and the "register" CTA read it; admin flips it from the dashboard.

**1.3 Seed.** A `prisma/seed.ts` that inserts default settings, the committees from the brochure, a starter fee table, and one admin user (your email). `npx prisma db seed`.

**Exit criteria:** schema migrated; seeded committees/fees/settings; `getContent()` returns typed, validated config.

---

## Phase 2 — Auth (NextAuth v5 magic link)

**2.1** `lib/auth.ts` using the Resend provider + Prisma adapter, JWT sessions:
```ts
import NextAuth from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import Resend from "next-auth/providers/resend"
import { prisma } from "@/lib/prisma"
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [ Resend({ from: process.env.EMAIL_FROM! }) ],
  callbacks: { /* attach role to session/jwt */ },
})
```
**2.2** Route handler `app/api/auth/[...nextauth]/route.ts` → `export const { GET, POST } = handlers`.
**2.3** `proxy.ts` (Next 16 — replaces `middleware.ts`; export `proxy`, Node runtime) protecting `/admin/*` (role ADMIN) and `/write/*` (signed in).
**2.4** A clean custom sign-in page (don't ship the default Auth.js page).

> Free-tier note: magic-link delivery **requires a Resend-verified domain** (the test sender only emails your own address). Verify the domain in Phase 6 before testing auth against real delegate addresses. Per Q3, if delegates are email-only, magic-link is needed solely for admins + blog authors — a tiny volume, well within free limits.

**Exit criteria:** you can sign in via emailed magic link; `/admin` rejects non-admins.

---

## Phase 3 — Public site + registration (no payment)

**3.1 Public layout & landing** — all copy from `getContent()`. Hero, dates, venue, agendas, awards, contacts — every word editable from the dashboard.

**3.2 Live availability board** — server component lists committees and AVAILABLE portfolio counts; a thin client island polls every 20s so counts update as admins allot. Shows what's open, never who got what.

**3.3 Registration form** — multi-step (mirrors your 5 form sections), one Zod schema shared by client and the Server Action:
- Step 1: personal (name, email, WhatsApp, alt phone, institution, DTU? , MUN experience).
- Step 2: committee pref 1 + portfolio pref 1.
- Step 3: committee pref 2 + portfolio pref 2 — **conditional logic**: if pref1 = UNHRC (doubleDelegation), lock pref2 and reveal the **co-delegate** sub-form; enforce your "UNHRC becomes the only preference" rule from the schema flag, not hardcoded.
- Step 4: accommodation (needs? + outside-NCR?) — captured only, no capacity logic.
- Step 5: undertaking checkbox (required) + reference.
- Submit → Server Action validates → creates `Delegate` (+ `CoDelegate`) with `status=REGISTERED`. **No payment yet.** Show a "we'll email your allotment + payment link" confirmation.
- Respect `content.registrationOpen`; closed → show a configurable "registrations closed" message.

**Exit criteria:** a delegate can register end-to-end (free), UNHRC branches correctly, data lands in DB, availability board is live.

---

## Phase 4 — Admin dashboard + allotment engine

**4.1 Admin shell** — sidebar nav, role-gated layout, command palette optional.

**4.2 Overview** — counts: registrations, by status, by committee, revenue (paid), accommodation requests, source breakdown. Recharts.

**4.3 Registrations table** — server-side pagination + filters (committee, status, source, DTU, accommodation) + search + XLSX/CSV export. Row click → **detail drawer** with every field, edit-on-behalf, payment + email history, and the **allot** action.

**4.4 Allotment board** — per-committee view of portfolios with status. To allot: open a portfolio → pick from a ranked list of delegates whose preferences match (engine *suggests*, human *confirms* — your "admin allots on experience/requirements" requirement). On confirm (a Server Action):
- Soft-lock the portfolio (`ON_HOLD`) while the modal is open; hard DB unique constraint on `Allotment.portfolioId` prevents double-allot by two admins.
- Create `Allotment`, flip portfolio → `ALLOTTED`, set delegate `status=ALLOTTED`.
- For UNHRC: allot the pair (delegate + co-delegate) to one portfolio.
- Trigger payment-link generation (Phase 5) + queue allotment email (Phase 6).

**4.5 Config panel** — edit settings/content, committees, the **Portfolio Matrix** (add/rename/bulk-paste portfolios per committee — countries, figures, or journalists), fees, dates, and the **registration open/close switch**. All writes go through `setContent`/Prisma; all reflect instantly on the public side.

**Exit criteria:** admin can allot a portfolio safely; availability board reacts; config edits change the public site with no deploy.

---

## Phase 5 — Payments (post-allotment, pluggable)

**5.1 Provider interface** `lib/payments/index.ts`:
```ts
export interface PaymentProvider {
  createPaymentLink(d: { delegateId: string; amountInr: number; email: string }):
    Promise<{ link: string; orderId?: string }>
}
```
**5.2 Razorpay impl** — server creates a Razorpay **Payment Link** (or Order) for the computed amount; returns the hosted link. Webhook at `/api/webhooks/razorpay` reads the **raw body**, verifies signature, is **idempotent** (safe on Razorpay's retries), and flips `Payment.status=PAID` + delegate `status=PAID→CONFIRMED`. Subscribe to `payment.captured` / `order.paid` / `payment.failed`.
**5.3 UPI-QR impl** — generates a UPI intent string (`upi://pay?pa=VPA&pn=NAME&am=AMT&tn=DELEGATEID`) rendered as a QR (qrcode.react) on a hosted "pay" page; delegate pays from any UPI app; **admin marks "Paid"** in the drawer after verifying (sets `status=OFFLINE→CONFIRMED`). Fully free, no KYC.
**5.4 Amount** computed from the `Fee` table by committee type + DTU flag — never a constant.
**5.5 Active provider** = `content.paymentProvider`; the allotment step calls whichever is active.

**Exit criteria:** allotment produces a working payment link/QR for the correct amount; Razorpay webhook confirms automatically; UPI path lets admin confirm manually.

---

## Phase 6 — Email automation (Resend + React Email)

**6.1** Verify your domain in Resend (DNS records). Until then, only your own address receives mail.
**6.2** React Email templates in `emails/`: **registration received**, **allotment + payment link** (committee, portfolio, agenda, amount, link/QR, accommodation note if requested), **co-delegate notice** (UNHRC), **payment confirmed**, **payment reminder**, **blog approved/changes**.
**6.3** `lib/resend.ts` send helpers; every send logged (status, template, recipient) and surfaced in the admin drawer with a **resend** button.
**6.4** No queue (BullMQ rejected): sends happen inline in the triggering Server Action; scheduled nudges run through **GitHub Actions**. Watch the free-tier 100 emails/day Resend cap until SES is enabled.

**Exit criteria:** confirming an allotment emails the delegate their portfolio + payment link automatically; admin can resend.

---

## Phase 7 — Cross-delegation flexible importer

**7.1** Admin uploads `.xlsx`/`.csv` (SheetJS parses in a Server Action).
**7.2** **Column-mapping UI**: show detected headers; admin maps each of *their* columns to our fields (fullName, email, committee, portfolio, …) via dropdowns. Mapping is saved as a reusable preset for that partner. This is how we handle "may or may not be in a format."
**7.3** **Preview + validate** each row with Zod; flag errors inline; let admin fix or skip.
**7.4** **Commit** → creates delegates with `source=CROSS_DEL` (+ note for partner name), optionally auto-allots if portfolio is named and available. Per your Q4 answer, either marks them `CONFIRMED` (comped) or triggers a payment link — same engine, so the availability board stays correct regardless of source.

**Exit criteria:** an arbitrary partner sheet imports cleanly via mapping; imported delegates flow through the same allotment/availability system.

---

## Phase 8 — Blog (Tiptap, magic-link authors, moderation)

**8.1 Editor** at `/write` (sign-in via magic link). Tiptap with StarterKit + Placeholder + bubble menu (selection toolbar) + floating "+" insert menu + image upload to S3 + link popover + typography + character-count → read-time. Store as JSON.
**8.2 Submit** → `status=PENDING`.
**8.3 Moderation queue** in admin: rendered preview + metadata; **approve** (→ PUBLISHED, public URL, notify author), **request changes** (author edits + resubmits), **reject** (reason).
**8.4 Public blog** — index + article page; Medium-style serif typography, ~680px column, cover image, byline, read time, tags. Render JSON → React server-side (sanitized).

**Exit criteria:** anyone can write via magic link; nothing is public until an admin approves; published posts read like Medium.

---

## Phase 9 — Quiz (SSE realtime, ≤200, internal)

**9.1 Builder** in admin: presentation → slides (MCQ / word cloud / scale / open text / content); per-slide config, correct answer + timer for QUIZ mode; drag reorder; live preview.
**9.2 Realtime model** via `/api/realtime` (Server-Sent Events, independent of Prisma/auth): each session has a 6-digit room code + a channel; **Presence** = live participant count; **Broadcast** = host events (advance/lock/reveal). Anonymous join with nickname — no account.
**9.3 Presenter view** (big screen): current question, join code + QR, live-animating results.
**9.4 Participant view** (phone): current question + answer control; updates the instant the host advances.
**9.5 Aggregation:** votes write to `Response`; presenter subscribes to the aggregated tally (counts per option) — don't broadcast every vote. Framer Motion springs for bar growth, count-ups, word-cloud scale-in, leaderboard reorder; confetti on the final leaderboard (QUIZ mode). 200-connection ceiling is comfortably inside one app container.

**Exit criteria:** a room of phones can join by code and answer; presenter shows live, animated results that feel like Mentimeter.

---

## Phase 10 — Design polish & deploy

**10.1 Design system pass** — tokens (8px grid, radii, the teal-anchored palette from your brochure headers, light+dark), type scale, motion (springs for data, 150–300ms for UI, `prefers-reduced-motion`), empty/loading(skeleton)/error states everywhere, toasts via sonner.
**10.2 QA** — mobile, accessibility (focus, ARIA, contrast), the double-allot race, webhook idempotency, RLS-equivalent checks in Server Actions (every mutation re-checks role + ownership server-side).
**10.3 Deploy** — PRs run CI only; pushes to `staging` and `main` build Docker images in GitHub Actions and deploy them to their isolated Lightsail boxes. Verify staging before promoting it to production.

---

## Free-tier ceilings to keep in mind
- **Resend:** 3,000 emails/mo, 100/day, domain verification required. Plan bulk allotment emails around the daily cap (batch over days, or upgrade only if a single edition exceeds it).
- **Lightsail:** one small box per environment keeps the database private and staging isolated; hourly S3 backups replace managed point-in-time recovery.
- **Razorpay:** ~2% per successful txn, needs KYC; UPI-QR path is the zero-cost fallback.

## Suggested build order if you want revenue/usefulness fastest
Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 (you now have the full register→allot→pay→email loop live) → 7 (cross-dels) → 8 (blog) → 9 (quiz) → 10 (polish). Ship the registration loop first; blog and quiz are independent and can follow.
