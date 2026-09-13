# DelTech MUN Platform — Build Spec

A single living document for building the MUN platform with Claude Code. Hand me the relevant section at the start of each working session.

---

## 0. The verdict (read this first)

**Start a fresh repo.** Your old repo is 2–3 years old, which means it predates React Server Components, Server Actions, the Next.js caching overhaul, and Turbopack-as-default. Porting it would cost more than a clean build, and you'd inherit patterns the framework now actively discourages.

**Recommended stack (all current as of June 2026):**

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router, React 19.2, Turbopack default, `proxy` not `middleware`, async `params`) | Current stable. Server Actions kill most of your API boilerplate; RSC keeps the registration dashboard fast. |
| Language | **TypeScript** (strict, ESM — `"type":"module"`) | Non-negotiable for a data-model-heavy app like this; Prisma 7 requires ESM. |
| DB + Realtime + Storage | **Supabase** (managed Postgres) | Relational DB for allotments, file storage for blog images, and the realtime websocket layer for the quiz. Realtime is free with the DB. (Auth is NextAuth, not Supabase Auth.) |
| ORM | **Prisma 7** (`prisma-client` generator + `@prisma/adapter-pg` driver adapter, `prisma.config.ts`) | Type-safe schema; v7 is Rust-free/ESM with a mandatory driver adapter and config-file datasource. |
| Auth | **NextAuth v5 (Auth.js)** magic link via Resend + Prisma adapter | Magic-link for admins + blog authors; guest registration for delegates. |
| Rich text editor | **Tiptap** (ProseMirror-based) | The standard for Notion/Medium-style editors. Headless, slash commands, bubble menus, image upload, stores clean JSON. |
| Realtime (quiz) | **Supabase Realtime** (Broadcast + Presence) | Already in the stack; no second vendor. If you ever outgrow it, Ably is the drop-in upgrade. |
| Payments | **UPI-QR (default, zero fee) — Razorpay pluggable** | UPI direct collection avoids the ~2% cut; Razorpay (Orders/Links + webhooks) available behind the same interface. |
| Email | **Resend** + **React Email** | Allotment emails as versioned React templates; great deliverability; cheap. Domain `deltechmun.in` verified. |
| UI | **Tailwind CSS v4** + **shadcn/ui** + **Framer Motion** | shadcn gives you owned, themeable components (not a locked dependency); Framer Motion powers the quiz animations. Design tokens in `src/styles/tokens.ts`. |
| Charts (results) | **Recharts** | Animated bar/donut reveals for quiz/dashboard. |
| Hosting | **AWS Lightsail** (app + Postgres) + **S3** (media/backups) | Separate production/staging boxes deployed by GitHub Actions. |
| Validation | **Zod** | One schema validates the form, the Server Action, and the DB write. |

> One mental model for the whole app: **the DB (Supabase Postgres via Prisma 7) is the source of truth, Next.js Server Actions are the only thing that writes to it, and every action re-checks role + ownership server-side.** Conference content, fees, and copy are DB-driven and editable from the dashboard — nothing hardcoded.

---

## 1. Roles & workflows (segregated first, as requested)

There are **four** actors. Get these boundaries right before writing a line of feature code, because every table and every route inherits from them.

### 1.1 Public / Visitor (no login)
- Reads published blog posts.
- Sees the **live availability board** (which committees/portfolios are still open — *not* who got what).
- Starts a delegate registration (account is created as part of registering).
- Joins a live quiz via a room code (no account needed — like Mentimeter's `menti.com`).

### 1.2 Delegate (logged-in registrant)
- Owns **one application**, can edit it until the deadline or until allotted.
- Sees their own payment status, allotment, accommodation status, and a downloadable confirmation.
- For UNHRC double delegation: manages co-delegate details and sees the linked partner.
- Cannot see other delegates' data. Ever. (Enforced server-side in every query/action — NextAuth session + ownership checks.)

### 1.3 Admin / Secretariat (the core dashboard user)
This is where 80% of the product value lives. Sub-permissions matter because a USG shouldn't have the same powers as the SG.

| Capability | Roles allowed |
|---|---|
| View all registrations + filter/search/export | All admins |
| Edit a registration on a delegate's behalf | Secretariat+ |
| Allot a portfolio (manual or accept auto-suggestion) | Secretariat+ |
| Send/resend allotment emails | Secretariat+ |
| Add cross-delegations / comped delegates | Secretariat+ |
| Configure committees, portfolios, fees, deadlines | SG / Tech only |
| Approve/reject blog posts | Editor role |
| Build & run quizzes | Quiz host role |
| Refunds, payment overrides | SG / Finance only |
| Manage admin accounts & roles | SG / Tech only |

Model this as `role` + a `permissions` array (or a simple role enum with a permission lookup) so you can hand someone "quiz host" without giving them the registration database.

### 1.4 System (automated)
- Razorpay webhook → marks payment captured/failed.
- Resend → sends allotment / confirmation / reminder emails.
- GitHub Actions cron → "registration closes in 24h" nudges, "complete your payment" reminders.

---

## 2. Module A — Blog (Medium clone)

**Goal:** open submission to anyone, WYSIWYG identical in feel to Medium, nothing published until an admin approves.

### 2.1 The editor (the part that must feel *exactly* like Medium)
Use **Tiptap** with these extensions to reproduce the Medium experience precisely:

- **StarterKit** (bold, italic, headings, lists, blockquote, code).
- **Placeholder** — "Tell your story…" ghost text.
- **Bubble menu** — the floating toolbar that appears on text selection (bold / italic / link / H1 / H2 / quote). This is *the* Medium signature interaction.
- **Floating "+" menu** — appears at the start of an empty line for inserting image / embed / divider.
- **Image** with drag-drop + paste upload → Supabase Storage; show upload progress, store the returned URL.
- **Link** with the inline edit popover.
- **Typography** extension for smart quotes / em-dashes (Medium does this).
- **CharacterCount** for the read-time estimate ("6 min read").
- **Slash commands** (`/`) for power users — optional, Medium-adjacent.

Store the document as **Tiptap JSON** in Postgres (`jsonb`), not HTML. Render published posts by converting JSON → React on the server (`generateHTML` from `@tiptap/html`, or a custom renderer for full control + safety). Never store raw HTML from users.

> **Design note:** Medium's editing canvas is ~680px wide, centered, generous line-height (~1.58), serif body (they use a Charter-like face), large airy headings. Match that. The editor chrome should be invisible — no persistent toolbar, just the bubble + floating menus. This is what makes it "feel like Medium."

### 2.2 Submission & approval flow
```
Visitor/Delegate writes → submits → status: PENDING
        → Admin (Editor role) sees it in a moderation queue
        → Approve  → status: PUBLISHED  (live, public URL)
        → Request changes → status: CHANGES_REQUESTED (author can edit & resubmit)
        → Reject  → status: REJECTED (with reason)
```
- Anyone can open the editor route, but submitting requires at minimum an email (create a lightweight author record). Decide: full account, or "magic link" author identity. Magic link is lower friction and very Medium-like.
- Moderation queue: side-by-side preview of the rendered post + metadata (author, submitted-at, word count). Approve / request-changes / reject buttons. Optional inline admin notes.
- On approve → optional "notify author" email via Resend.

### 2.3 Blog data model (sketch)
```
authors        (id, email, display_name, avatar_url, bio, created_at)
posts          (id, author_id, title, subtitle, slug, cover_image_url,
                content_json jsonb, status, read_time_min, tags text[],
                submitted_at, published_at, reviewed_by, review_note)
post_status    enum: DRAFT | PENDING | CHANGES_REQUESTED | PUBLISHED | REJECTED
```
- `slug` generated from title + short hash; immutable once published.
- Public blog index reads only `status = PUBLISHED`, ordered by `published_at`.
- Access rules (enforced in Server Actions): authors read/write their own non-published posts; everyone reads published; admins read all.

### 2.4 Public reading experience
- Clean article page (Medium-style typography, cover image, author byline, read time, tags).
- Index / feed with cards.
- Optional: claps/reactions, but treat as v2.

---

## 3. Module B — Registration portal (the heart of the system)

This is the most complex module because of the real domain rules in your Google Form. I've modelled it directly from your form so nothing is hand-wavy.

### 3.1 Domain rules extracted from your form
1. **Committees** (admin-configurable, but seeded from your form): UNGA-DISEC, UNHRC (Double Delegation), AIPPM, Lok Sabha, IP. (Your brochure also lists UNCSW — make committees fully editable so this kind of mismatch is a non-issue.)
2. **Two committee preferences** with a **portfolio preference** for each, referencing a **Portfolio Matrix** (committee × available portfolios/countries/roles).
3. **UNHRC special rule:** if UNHRC is Preference 1, it becomes the *only* preference and the delegate must supply **co-delegate** details (name, email, phone, institution, MUN experience). Your form even forces "select UNHRC in Preference 2 too."
4. **Accommodation:** only for delegates **outside Delhi-NCR**, first-come-first-serve, Yes/No; tariff shared over email.
5. **Undertaking** declaration (must agree).
6. **Fee structure** (drives Razorpay amount):
   - Regular: ₹1600 / delegate · ₹3200 / UNHRC double delegation · ₹1400 / IP
   - DTU students: ₹1500 / delegate · ₹3000 / UNHRC double · ₹1400 / IP
   - **Make every number a row in a `fees` table**, not a constant. Fees change every year.
7. Captured per delegate: email, full name, WhatsApp number, alternative number, institution, MUN experience.

### 3.2 The allotment engine (your "dynamic, editable, see-what's-available" requirement)
This is the feature that makes it more than a glorified form.

**Core concept:** a **Portfolio Matrix** = committee → list of portfolios, each portfolio carrying a status:
```
portfolio_status: AVAILABLE | ON_HOLD | ALLOTTED | BLOCKED
```
- **Public availability board** reads the matrix in realtime and shows only AVAILABLE counts/names per committee — so a delegate choosing preferences sees what's actually open, and it updates live as admins allot. (Supabase Realtime subscription on the `portfolios` table → no refresh needed.)
- **Admin allotment screen:** a grid/kanban per committee. Drag a delegate onto a portfolio, or click a portfolio → pick from a ranked list of delegates whose preferences match. The engine surfaces suggestions ("3 delegates picked France as P1"), but the human always confirms.
- **Allotment record** links delegate(s) ↔ committee ↔ portfolio. For UNHRC, the allotment links a **pair**.
- The instant an allotment is confirmed → portfolio flips to ALLOTTED → availability board updates → allotment email queued.

**Concurrency safety:** two admins must never allot the same portfolio. Use a DB-level unique constraint on `(portfolio_id)` in the allotments table + an `ON_HOLD` soft-lock when an admin opens the allotment modal. This is the one place to be strict.

### 3.3 Cross-delegations & other sources (your explicit question)
You'll get delegates from outside the normal funnel: partner MUNs, sponsorships, internal DTU quotas, last-minute swaps. Handle them as **first-class records with a `source` field**, not hacks:
```
registration_source: SELF_REGISTERED | CROSS_DELEGATION | SPONSORED | INTERNAL_QUOTA | MANUAL
```
Two entry paths for admins:
1. **Single manual add** — a form in the dashboard that creates a registration + allotment directly, with payment marked as `COMPED` / `EXTERNAL` / `PAID_OFFLINE` as appropriate. Bypasses Razorpay.
2. **Bulk CSV import** — for a batch from a partner conference. Upload → preview/validate (Zod) → map columns → commit. Each imported row is tagged with its source and the partner name.

Because cross-delegations consume real portfolios, they go through the **same allotment engine and the same matrix** — so the availability board stays accurate no matter where a delegate came from. That's the key: one allotment system, many sources.

### 3.4 Payments (Razorpay) — the verified flow
Never trust the browser. The proven pattern (and the one to implement):
```
1. Delegate finishes form → Server Action computes amount from fees table
2. Server creates a Razorpay Order (amount in paise = ₹ × 100) → returns order_id
3. Browser opens Razorpay Checkout with order_id + public key_id
4. On success, Razorpay returns payment_id + order_id + signature
5. Server verifies signature (HMAC-SHA256 of order_id|payment_id with key_secret)
6. Webhook (payment.captured / order.paid) is the SOURCE OF TRUTH —
   ~3–5% of users close the tab before step 4 fires
7. Webhook handler verifies its own (different) signature, is idempotent
   (safe to run twice — Razorpay retries), flips payment to CAPTURED
```
- Store `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` server-side only; only `key_id` is public.
- Webhook route must read the **raw body** for signature verification (don't let the framework parse it first).
- Subscribe to `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`.
- A registration is only "complete" when payment is CAPTURED **and** all required fields pass validation.

### 3.5 Email automation (allotments & lifecycle)
Built on Resend + React Email, all templates versioned in the repo:
- **Registration received** (immediately after payment captured).
- **Allotment email** — fires when admin confirms an allotment. Includes committee, portfolio, agenda, and (for accommodation: Yes) the tariff details. This is your "automate the mailing of allotments" requirement.
- **Co-delegate notification** (UNHRC) — loop in the partner.
- **Payment reminder** (cron, for incomplete registrations).
- **Deadline reminder** (cron).
- Every send is logged in an `email_log` table (to whom, which template, status) so admins can see "allotment email: delivered" in the dashboard and resend on demand.

### 3.6 Admin dashboard (must feel like a top-tier SaaS)
- **Overview:** registrations over time, revenue (paid vs pending), fill rate per committee, accommodation requests, source breakdown.
- **Registrations table:** server-side pagination, column filters (committee, payment status, source, accommodation, institution), full-text search, saved views, CSV/XLSX export, bulk actions.
- **Allotment board:** per-committee grid described in 3.2.
- **Single registration drawer:** every field, payment history, email history, edit-on-behalf, manual allotment, notes.
- **Config panel (SG/Tech):** committees, portfolios (the matrix editor), fees, deadlines, accommodation capacity, award definitions — all editable, all immediately reflected on the public side ("dynamic and editable" requirement).

### 3.7 Registration data model (sketch)
```
delegates        (id, user_id, full_name, email, whatsapp, alt_phone,
                  institution, is_dtu_student, mun_experience text,
                  source, created_at)
applications     (id, delegate_id, pref1_committee_id, pref1_portfolio_text,
                  pref2_committee_id, pref2_portfolio_text,
                  needs_accommodation bool, outside_ncr bool,
                  undertaking_accepted bool, reference_text,
                  status, submitted_at)
co_delegates     (id, application_id, full_name, email, phone,
                  institution, mun_experience)     -- UNHRC only
committees       (id, name, type, agenda, double_delegation bool,
                  eb_members jsonb, is_active)
portfolios       (id, committee_id, name, status, allotted_to_application_id)
allotments       (id, application_id, committee_id, portfolio_id,
                  partner_application_id nullable, allotted_by,
                  allotted_at, email_sent_at)   -- unique on portfolio_id
fees             (id, committee_type, is_dtu, amount_inr, year)
payments         (id, application_id, razorpay_order_id, razorpay_payment_id,
                  amount_inr, status, method, webhook_confirmed, created_at)
payment_status   enum: PENDING | CAPTURED | FAILED | REFUNDED | COMPED | OFFLINE
email_log        (id, application_id, template, to_email, status, sent_at)
```

### 3.8 Application status machine
```
DRAFT → SUBMITTED → PAYMENT_PENDING → PAID
      → ALLOTTED → CONFIRMED
(plus: WAITLISTED, CANCELLED, REFUNDED as side states)
```
Every transition is a Server Action with a permission check and an audit log entry.

---

## 4. Module C — Quiz platform (Mentimeter clone)

**Goal:** picture-perfect to Mentimeter — a host builds interactive questions, a big-screen presentation view shows live results animating in as a room of people answer from their phones.

### 4.1 The two surfaces (this is Mentimeter's whole model)
1. **Presenter view** (big screen) — shows the current question, a join code + QR, and the live-updating result chart. Host controls navigation (next/prev, lock voting, reveal).
2. **Participant view** (phone) — enters the room code, sees only the current question and an answer control. No account. Updates the instant the host advances.

### 4.2 Realtime architecture
- Each session has a short **room code** (e.g. 6 digits) + a Supabase Realtime **channel**.
- **Presence** tracks live participant count ("142 connected").
- **Broadcast** pushes host events (advance question, lock, reveal) to all participants instantly.
- Votes write to Postgres; presenter subscribes to aggregated results via Realtime → bars grow live.
- Aggregate server-side (counts per option), broadcast the tally — don't ship every individual vote to every client.

### 4.3 Question types (match Mentimeter)
- **Multiple choice** — animated horizontal bars.
- **Word cloud** — words scale by frequency, animate in (Mentimeter's signature).
- **Scales / rating** — average needle or distribution.
- **Open text** — answers stream into a wall of cards.
- **Ranking**, **Q&A**, **pin-on-image** — v2.
- **Quiz competition mode** — points by speed + correctness, leaderboard between questions (the Kahoot-style variant Mentimeter also has). This is great for an MUN socials/icebreaker.

### 4.4 The "picture perfect" details that sell it
- **Smooth bar growth** — animate value changes with Framer Motion springs, never snap.
- **Count-up numbers** on the percentages.
- **Staggered entrance** of options.
- **Word cloud** with collision-avoidance layout + scale/fade transitions.
- **Leaderboard reveal** — rows slide/reorder between questions.
- **QR + big join code** persistently on the presenter screen.
- **Confetti / celebration** on the final leaderboard (quiz mode).
- **Theme per presentation** (colors, font) — admin-configurable, like Mentimeter themes.
- 60fps target; offload heavy layout to `requestAnimationFrame`/transforms, not React re-renders per vote.

### 4.5 Quiz builder (admin)
- Create presentation → add slides (each slide = a question or a content slide).
- Per question: type, prompt, options, correct answer (quiz mode), time limit, theme.
- Reorder by drag. Live preview. Duplicate slide. Import questions (CSV) for big quizzes.
- "Present" button → launches presenter view + opens the room.

### 4.6 Quiz data model (sketch)
```
presentations (id, owner_id, title, theme jsonb, mode, created_at)
slides        (id, presentation_id, order_index, type, prompt, config jsonb)
sessions      (id, presentation_id, room_code, status, current_slide_id,
               started_at, ended_at)
participants  (id, session_id, nickname, joined_at)        -- ephemeral
responses     (id, session_id, slide_id, participant_id, answer jsonb,
               points int, responded_at)
```
- `responses` is the hot table — index on `(session_id, slide_id)`; aggregate with a grouped query, cache the tally in memory on the presenter.

---

## 5. Design system — exact implementations

You asked for "literally the best SaaS platform to exist." That comes from **restraint + consistency + motion**, not decoration. Here's a concrete, opinionated system to implement, not vague vibes.

### 5.1 Foundations
- **Tailwind v4** with a token layer in CSS variables so the whole app (and quiz themes) can be re-skinned.
- **shadcn/ui** as the component base — you own the code, so you can push it past the default look.
- **Geist** or **Inter** for UI; a refined serif (Charter/Lora/Source Serif) for blog body text only.
- **8px spacing grid.** Everything aligns to 4/8/12/16/24/32/48/64.
- **Radius:** 8px default, 12px for cards, full for pills/avatars. Stay consistent.
- **Borders over shadows** for structure; one soft shadow for elevation (modals, popovers, dropdowns). Avoid shadow soup.

### 5.2 Color (suggested, tune to DelTech brand)
- Pull from your existing teal section headers as the anchor. A deep teal/diplomatic-navy primary reads "serious international conference," not "startup pastel."
- **Primary:** deep teal `#0F6B6B`-ish → with 50–900 scale.
- **Neutrals:** a true gray ramp (slate) for 90% of the UI.
- **Semantic:** green (paid/approved), amber (pending), red (failed/rejected), blue (info).
- **One accent** for CTAs and quiz energy. Don't introduce a fourth hue.
- Ship **light + dark** from day one (CSS variable tokens make this nearly free).

### 5.3 Typography scale
- Display 36/44 · H1 30/38 · H2 24/32 · H3 20/28 · Body 16/24 · Small 14/20 · Caption 12/16.
- Tighten letter-spacing slightly on large headings; never on body.
- Blog body specifically: ~18px serif, line-height ~1.6, max width ~680px (Medium parity).

### 5.4 Component conventions
- **shadcn/ui only — no raw HTML form controls.** Every interactive element is a shadcn component: `Input`, `Textarea`, `Select`, `Combobox` (searchable selects), `Checkbox`, `RadioGroup`, `Switch`, `Slider`, `Button`. Dates use the shadcn `Calendar` inside a `Popover` (DatePicker pattern) — **never** `<input type="date">` or any native picker (they render inconsistently and look broken across browsers). Overlays use `Dialog`/`Sheet`/`Drawer`, notifications use `Sonner`/`Toast`, search/palettes use `Command`. If a primitive isn't installed yet, add it with `npx shadcn@latest add <name>` rather than dropping to native HTML.
- **Buttons:** primary (solid), secondary (outline), ghost, destructive. One size system (sm/md/lg). Loading state with spinner + disabled. Never more than one primary button per view section.
- **Tables:** shadcn `Table`, sticky header, zebra off / hover-highlight on, row click opens a side `Drawer`/`Sheet` (don't navigate away). Column visibility + filter chips above.
- **Forms:** shadcn `Form` (+ react-hook-form + Zod). Label above input, helper text below, inline validation on blur, error in red with icon. Multi-step registration → a progress stepper that mirrors your form's 5 sections.
- **Empty states:** every list has a designed empty state with an icon + one-line guidance + a CTA.
- **Toasts** (`Sonner`) for confirmations, **inline banners**/`Alert` for page-level state, **`AlertDialog`** for destructive confirms.
- **Skeletons** (shadcn `Skeleton`, not spinners) for content loading; spinners only inside button actions.

### 5.5 Motion (the layer that makes it feel premium)
- Framer Motion everywhere intentional: page transitions (subtle fade/slide), list item stagger, drawer slide-in, number count-ups.
- **Spring physics**, not linear easings, for anything that represents data (quiz bars, dashboard counters).
- Respect `prefers-reduced-motion`.
- Keep durations short (150–300ms) for UI; the quiz reveals can be more theatrical (400–800ms).

### 5.6 Key screens to design first
1. Public landing + live availability board.
2. Multi-step registration (5 steps mirroring the form) + Razorpay checkout + success.
3. Delegate dashboard (my application, payment, allotment).
4. Admin: registrations table + single-registration drawer.
5. Admin: allotment board.
6. Blog editor (Tiptap) + moderation queue + public article.
7. Quiz builder + presenter view + participant view.

---

## 6. Security & correctness (don't skip)
- **Server-side authorization**: every Server Action re-checks the NextAuth session, role, and record ownership before reading/writing — never trust the client. (Postgres RLS optional later, but auth is via NextAuth, not Supabase Auth.)
- **Server Actions** are the only write path; validate with Zod at the boundary; never trust client input.
- **Idempotent webhooks** (Razorpay retries; the handler must be safe to run twice).
- **Audit log** for every admin mutation (who changed what, when) — essential for a money + allotment system.
- **Rate-limit** public routes (registration, quiz join) to stop abuse.
- Secrets in env only; `key_id`/public Razorpay key is the only thing that touches the browser.

---

## 7. Build roadmap (suggested order)
**Phase 0 — Foundation (week 1):** repo, Next 16 + TS (ESM) + Tailwind v4 + shadcn, Supabase project, Prisma 7 schema (driver adapter + prisma.config.ts), NextAuth, roles, design tokens (src/styles/tokens.ts), base layout + admin shell.

**Phase 1 — Registration core (weeks 2–3):** committees/portfolios/fees config, multi-step form, Zod validation, Razorpay order + verify + webhook, payment status, registration-received email. *(This is the revenue path — ship it first.)*

**Phase 2 — Admin + allotment (weeks 3–4):** registrations table, single-registration drawer, allotment board, allotment emails, availability board (realtime), cross-delegation manual add + CSV import, exports.

**Phase 3 — Blog (week 5):** Tiptap editor, submission flow, moderation queue, public blog.

**Phase 4 — Quiz (weeks 6–7):** builder, session/room codes, realtime layer, MCQ + word cloud + scale + open text, presenter + participant views, quiz mode + leaderboard.

**Phase 5 — Polish (week 8):** motion pass, empty/loading/error states, dark mode QA, mobile QA, accessibility, cron reminders, analytics dashboard.

---

## 8. Open questions for you (decide these before Phase 1)
1. **Blog author identity:** full accounts or magic-link authors? (Magic link = more submissions, more Medium-like.)
2. **Portfolio Matrix format:** is it country names per committee, or roles? Share the actual matrix and I'll seed it.
3. **Refund policy:** automated via Razorpay, or admin-initiated only?
4. **Accommodation capacity:** hard cap (first-come auto-cutoff) or admin-managed waitlist?
5. **Admin roles:** confirm the exact role list (SG, USG-Delegate-Affairs, Tech, Finance, Editor, Quiz Host…) so I can build the permission map.
6. **Quiz audience:** internal socials/icebreakers, or a public-facing feature? (Affects scale + auth.)
7. **Domain & branding:** final color/logo assets so the design system anchors to the real brand, not a placeholder teal.
8. **Cross-delegation sources:** which partners, and do they send CSVs in a fixed format? (Lets me build the import mapping now.)

---

### What I think, briefly
The registration portal is the project. The blog and quiz are bounded, well-understood clones — Tiptap and Supabase Realtime do the heavy lifting, and they'll go quickly. The allotment engine + payments + cross-delegation handling is where the real design work is, and it's worth getting the data model right on day one because everything (dashboard, emails, availability board, exports) reads from it. Build the money path first, make the matrix and fees fully admin-editable so you never touch code between editions, and treat every delegate — self-registered or cross-delegation — as the same kind of record flowing through one allotment system.
