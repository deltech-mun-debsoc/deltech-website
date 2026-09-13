import {
  BookOpen,
  Compass,
  Feather,
  Landmark,
  Code2,
  Users,
  type LucideIcon,
} from "lucide-react"

// The single source of truth for the docs site: sidebar, mobile drawer, search,
// breadcrumbs, prev/next pager, the landing page role cards and the sitemap all
// read this file. scripts/check-docs-links.ts asserts it stays in sync with the
// page.mdx files on disk in both directions, so a renamed page fails the build
// instead of silently orphaning itself.
//
// Labels live here as plain strings rather than in src/content/strings.ts for
// the same reason src/app/(admin)/_components/admin-nav.ts does: they are route
// metadata consumed by a data loop, not copy rendered as a JSX text node.

export interface DocPage {
  href: string
  label: string
  /** One line. Shown under search results and on section index cards. */
  summary: string
  /** Extra search terms a reader might type instead of the label. */
  keywords?: string[]
}

export interface DocSection {
  id: string
  label: string
  /** Who this section is written for, in the reader's own words. */
  audience: string
  blurb: string
  icon: LucideIcon
  pages: DocPage[]
}

export const SECTIONS: DocSection[] = [
  {
    id: "start",
    label: "Start here",
    audience: "Everyone",
    blurb: "What this platform is, who each part of it is for, and the words we use.",
    icon: Compass,
    pages: [
      {
        href: "/docs",
        label: "Introduction",
        summary: "What the DelTech MUN platform does and how to find your way around these docs.",
        keywords: ["home", "index", "overview", "getting started"],
      },
      {
        href: "/docs/what-is-this",
        label: "What the platform does",
        summary: "A tour of the five surfaces: the public site, the delegate area, the admin console, the recruitment console and the live quiz.",
        keywords: ["tour", "surfaces", "features", "sitemap"],
      },
      {
        href: "/docs/glossary",
        label: "Glossary",
        summary: "Committee, portfolio, matrix, allotment, double delegation, GD, PI, dispatch, cycle.",
        keywords: ["terms", "definitions", "jargon", "vocabulary", "meaning"],
      },
    ],
  },
  {
    id: "delegates",
    label: "For delegates",
    audience: "Delegates and applicants",
    blurb: "Register, get allotted a portfolio, pay, and turn up. No technical knowledge needed.",
    icon: BookOpen,
    pages: [
      {
        href: "/docs/delegates",
        label: "The delegate journey",
        summary: "The whole path from registering to walking into your committee, in one picture.",
        keywords: ["overview", "journey", "flow", "steps", "start"],
      },
      {
        href: "/docs/delegates/account",
        label: "Creating your account",
        summary: "You can register without an account, but an account gives you a dashboard.",
        keywords: ["signup", "sign up", "register account", "password"],
      },
      {
        href: "/docs/delegates/signing-in",
        label: "Signing in",
        summary: "Magic links, passwords, and what to do when you forget yours.",
        keywords: ["login", "log in", "signin", "magic link", "forgot password", "reset"],
      },
      {
        href: "/docs/delegates/register-personal",
        label: "Registering: your details",
        summary: "Step 1 of 5. Name, email, phone, and the DTU student toggle.",
        keywords: ["step 1", "personal", "dtu", "institution", "whatsapp"],
      },
      {
        href: "/docs/delegates/register-preferences",
        label: "Registering: committee choice",
        summary: "Step 2 of 5. Picking your first committee and the portfolio you want in it.",
        keywords: ["step 2", "preference", "committee", "portfolio", "country"],
      },
      {
        href: "/docs/delegates/register-partner",
        label: "Registering: partner or second choice",
        summary: "Step 3 of 5. Double delegation asks for a partner; everything else asks for a backup.",
        keywords: ["step 3", "co-delegate", "codelegate", "partner", "double delegation", "second preference"],
      },
      {
        href: "/docs/delegates/register-accommodation",
        label: "Registering: accommodation",
        summary: "Step 4 of 5. Two optional questions about where you are travelling from.",
        keywords: ["step 4", "accommodation", "stay", "hostel", "ncr", "outstation"],
      },
      {
        href: "/docs/delegates/register-undertaking",
        label: "Registering: the undertaking",
        summary: "Step 5 of 5. The reference field and the box you have to tick.",
        keywords: ["step 5", "undertaking", "declaration", "submit", "reference"],
      },
      {
        href: "/docs/delegates/matrix",
        label: "Reading the portfolio matrix",
        summary: "What available, on hold, allotted and blocked mean before you pick.",
        keywords: ["matrix", "availability", "portfolios", "countries", "open seats"],
      },
      {
        href: "/docs/delegates/status",
        label: "Tracking your application",
        summary: "Your private status link, and what every status actually means.",
        keywords: ["status", "token", "track", "registered", "allotted", "confirmed", "waitlist"],
      },
      {
        href: "/docs/delegates/dashboard",
        label: "Your dashboard",
        summary: "The signed-in view of your registration, allotment and payment.",
        keywords: ["dashboard", "my account", "home"],
      },
      {
        href: "/docs/delegates/payment",
        label: "Paying your fee",
        summary: "How your fee is worked out, the three ways to pay, deadlines and refunds.",
        keywords: ["pay", "payment", "fee", "razorpay", "upi", "qr", "refund", "receipt"],
      },
      {
        href: "/docs/delegates/check-in",
        label: "Check-in day",
        summary: "The QR code on your status page, and what to bring to the desk.",
        keywords: ["checkin", "check in", "qr", "arrival", "desk", "conference day"],
      },
      {
        href: "/docs/delegates/emails",
        label: "Emails you will receive",
        summary: "Every message the platform sends you, when it arrives and what to do with it.",
        keywords: ["email", "inbox", "spam", "notifications", "confirmation"],
      },
      {
        href: "/docs/delegates/quiz",
        label: "Joining a live quiz",
        summary: "Room codes, nicknames and how scoring works in a live session.",
        keywords: ["quiz", "poll", "room code", "join", "nickname", "leaderboard"],
      },
      {
        href: "/docs/delegates/troubleshooting",
        label: "Troubleshooting",
        summary: "No email, wrong details, payment failed, cannot sign in: what to do first.",
        keywords: ["problem", "help", "stuck", "error", "failed", "support", "faq"],
      },
    ],
  },
  {
    id: "writers",
    label: "For writers",
    audience: "Dispatch contributors",
    blurb: "Writing and publishing articles on the Dispatch.",
    icon: Feather,
    pages: [
      {
        href: "/docs/writers",
        label: "Writing a dispatch",
        summary: "The editor, autosave, cover images and formatting.",
        keywords: ["blog", "dispatch", "article", "write", "editor", "tiptap", "draft"],
      },
      {
        href: "/docs/writers/review",
        label: "Submitting for review",
        summary: "What happens after you submit, and how to read the four review outcomes.",
        keywords: ["review", "publish", "approved", "rejected", "changes requested", "moderation"],
      },
    ],
  },
  {
    id: "staff",
    label: "For staff",
    audience: "Secretariat and organisers",
    blurb: "Running a conference from the admin console: setup, intake, allotment, money, and the desk on the day.",
    icon: Landmark,
    pages: [
      {
        href: "/docs/staff",
        label: "Staff overview",
        summary: "What the admin console is, and the order to read these pages in.",
        keywords: ["admin", "staff", "overview", "console", "secretariat"],
      },
      {
        href: "/docs/staff/roles",
        label: "Roles and permissions",
        summary: "Every role in the system and exactly which actions each one can take.",
        keywords: ["roles", "permissions", "admin", "maintainer", "author", "registerer", "access"],
      },
      {
        href: "/docs/staff/account",
        label: "Getting your staff account",
        summary: "How invites work and why staff sign in through a different door.",
        keywords: ["invite", "staff signin", "account", "onboarding"],
      },
      {
        href: "/docs/staff/console",
        label: "A tour of the console",
        summary: "The sidebar, the theme toggle, the preview badge and where everything lives.",
        keywords: ["tour", "navigation", "sidebar", "layout", "admin"],
      },
      {
        href: "/docs/staff/launch",
        label: "Launching a conference",
        summary: "The six-step order to set things up in, and the checklist that tracks it.",
        keywords: ["launch", "setup", "checklist", "runbook", "go live", "order"],
      },
      {
        href: "/docs/staff/modes",
        label: "Operating modes and presets",
        summary: "Society, Intra MUN and Conference mode, plus the switches that hide public sections.",
        keywords: ["mode", "society", "intra", "conference", "preset", "sections", "event control"],
      },
      {
        href: "/docs/staff/identity",
        label: "Conference identity and copy",
        summary: "Dates, venue, awards, contacts and the public text on the homepage.",
        keywords: ["copy", "content", "identity", "venue", "dates", "awards", "contacts"],
      },
      {
        href: "/docs/staff/committees",
        label: "Committees and the matrix",
        summary: "Creating committees, building the portfolio matrix, and who can see it.",
        keywords: ["committee", "portfolio", "matrix", "agenda", "crisis", "press", "ai"],
      },
      {
        href: "/docs/staff/fees",
        label: "Fees and payment setup",
        summary: "Fee tiers, the payment provider, deadlines and the refund note.",
        keywords: ["fee", "money", "payment", "razorpay", "upi", "provider", "pricing"],
      },
      {
        href: "/docs/staff/registration",
        label: "Opening and closing registration",
        summary: "The one switch that turns intake on, and the message shown when it is off.",
        keywords: ["open", "close", "registration", "intake", "switch"],
      },
      {
        href: "/docs/staff/registrations",
        label: "The registrations desk",
        summary: "Searching, filtering, correcting records and exporting data.",
        keywords: ["registrations", "delegates", "search", "filter", "export", "edit", "drawer"],
      },
      {
        href: "/docs/staff/allotment",
        label: "The allotment floor",
        summary: "Matching delegates to portfolios, the two-minute hold, and why revoking is guarded.",
        keywords: ["allotment", "allot", "assign", "portfolio", "hold", "revoke", "balance"],
      },
      {
        href: "/docs/staff/payments",
        label: "Payments and reconciliation",
        summary: "Marking paid offline, comping a fee, cancelling, and the reminder cron.",
        keywords: ["payment", "reconcile", "offline", "comp", "cancel", "reminder", "refund"],
      },
      {
        href: "/docs/staff/check-in",
        label: "The check-in desk",
        summary: "Running the desk on conference day, by QR scan or by search.",
        keywords: ["checkin", "check in", "desk", "qr", "scan", "arrival"],
      },
      {
        href: "/docs/staff/imports",
        label: "Cross-delegation imports",
        summary: "The four-step wizard, AI column mapping, and the quarantine queue.",
        keywords: ["import", "csv", "xlsx", "spreadsheet", "bulk", "quarantine", "mapping"],
      },
      {
        href: "/docs/staff/sheets",
        label: "Google Forms and Sheets",
        summary: "Live form intake, the nightly re-sync, and the sheet mirror.",
        keywords: ["google", "forms", "sheets", "webhook", "sync", "apps script"],
      },
      {
        href: "/docs/staff/dispatch",
        label: "Moderating the Dispatch",
        summary: "The review queue and the three decisions you can make on a post.",
        keywords: ["blog", "dispatch", "moderation", "approve", "reject", "review"],
      },
      {
        href: "/docs/staff/quiz-build",
        label: "Building a quiz",
        summary: "Slides, the eight slide types, poll versus quiz mode, and themes.",
        keywords: ["quiz", "poll", "slides", "builder", "presentation", "mcq", "wordcloud"],
      },
      {
        href: "/docs/staff/quiz-present",
        label: "Presenting a quiz",
        summary: "Running a live session, the room code, timing and the leaderboard.",
        keywords: ["present", "projector", "live", "room code", "session", "leaderboard"],
      },
      {
        href: "/docs/staff/team",
        label: "The team roster",
        summary: "Adding secretariat members, cropping photos and ordering the public page.",
        keywords: ["team", "roster", "photo", "council", "secretariat", "crop"],
      },
      {
        href: "/docs/staff/users",
        label: "Users and participants",
        summary: "Inviting staff, changing roles, disabling accounts, and the admin safety net.",
        keywords: ["users", "staff", "invite", "role", "disable", "delete", "participants"],
      },
      {
        href: "/docs/staff/logs",
        label: "Activity log and rollback",
        summary: "Reading the audit trail and reversing a change that should not have happened.",
        keywords: ["audit", "log", "history", "rollback", "undo", "who did"],
      },
      {
        href: "/docs/staff/email",
        label: "Email delivery",
        summary: "Which messages the platform sends, how to spot a failure and how to resend.",
        keywords: ["email", "resend", "failed", "delivery", "bounce", "log"],
      },
      {
        href: "/docs/staff/recovery",
        label: "When something goes wrong",
        summary: "The five-step recovery protocol, and the rules that keep incidents small.",
        keywords: ["recovery", "incident", "broken", "mistake", "fix", "emergency"],
      },
    ],
  },
  {
    id: "recruitment",
    label: "For the council",
    audience: "Recruitment council",
    blurb: "Running a recruitment cycle: intake, group discussions, interviews, and selection.",
    icon: Users,
    pages: [
      {
        href: "/docs/recruitment",
        label: "Recruitment overview",
        summary: "The pipeline from an application form to a society member, in one picture.",
        keywords: ["recruitment", "overview", "pipeline", "hiring", "selection"],
      },
      {
        href: "/docs/recruitment/roles",
        label: "Council roles",
        summary: "Junior, Senior and Administrative Council, and why they are separate from staff roles.",
        keywords: ["jc", "sc", "ac", "junior council", "senior council", "permissions", "capability"],
      },
      {
        href: "/docs/recruitment/lifecycle",
        label: "The cycle lifecycle",
        summary: "Draft, open, in progress, paused, finalisation, completed: what each state allows.",
        keywords: ["cycle", "state", "lifecycle", "draft", "open", "paused", "archive"],
      },
      {
        href: "/docs/recruitment/setup",
        label: "Setting up a cycle",
        summary: "Stage rules, the two rubrics, and the selection email settings.",
        keywords: ["setup", "configure", "rubric", "criteria", "stages", "create cycle"],
      },
      {
        href: "/docs/recruitment/import",
        label: "Importing responses",
        summary: "Connecting a Google Sheet, mapping columns, and why re-importing is safe.",
        keywords: ["import", "sheet", "responses", "candidates", "mapping", "idempotent"],
      },
      {
        href: "/docs/recruitment/gd",
        label: "Running a group discussion",
        summary: "Creating a panel, the console, attendance and the session timer.",
        keywords: ["gd", "group discussion", "panel", "session", "timer", "attendance"],
      },
      {
        href: "/docs/recruitment/pi",
        label: "Conducting interviews",
        summary: "The interview queue, the one-candidate console and the post-interview decision.",
        keywords: ["pi", "interview", "personal interview", "queue", "console"],
      },
      {
        href: "/docs/recruitment/scoring",
        label: "Scoring and the rubric",
        summary: "How criteria are weighted, why scores are comparable, and what a recommendation means.",
        keywords: ["score", "rubric", "criteria", "weight", "evaluation", "recommendation", "panel vote"],
      },
      {
        href: "/docs/recruitment/dossier",
        label: "The candidate dossier",
        summary: "Everything recorded about one candidate, on one page.",
        keywords: ["dossier", "candidate", "profile", "history", "record"],
      },
      {
        href: "/docs/recruitment/decisions",
        label: "Decisions, holds and bypasses",
        summary: "Advancing, holding, skipping a stage, withdrawing and disqualifying.",
        keywords: ["decision", "hold", "bypass", "skip", "withdraw", "disqualify", "reject"],
      },
      {
        href: "/docs/recruitment/finalisation",
        label: "Finalisation and the society",
        summary: "Why selecting someone and adding them to the society are two deliberate steps.",
        keywords: ["finalise", "finalize", "select", "recruit", "society", "member"],
      },
      {
        href: "/docs/recruitment/emails",
        label: "Selection emails",
        summary: "Sending results, what the message contains, and why it cannot double-send.",
        keywords: ["email", "selection", "result", "whatsapp", "notify"],
      },
      {
        href: "/docs/recruitment/audit",
        label: "The audit trail",
        summary: "Every recruitment action is recorded. Here is how to read it.",
        keywords: ["audit", "trail", "log", "history", "accountability"],
      },
    ],
  },
  {
    id: "developers",
    label: "For developers",
    audience: "Engineers",
    blurb: "Architecture, conventions, the data model, and every subsystem in the codebase.",
    icon: Code2,
    pages: [
      {
        href: "/docs/developers",
        label: "Architecture",
        summary: "How a request travels from the edge to the database, and what talks to what.",
        keywords: ["architecture", "overview", "stack", "diagram", "next.js", "aws", "hosting", "lightsail", "caddy", "infrastructure"],
      },
      {
        href: "/docs/developers/setup",
        label: "Local setup",
        summary: "From a clean clone to a running dev server, including the database options.",
        keywords: ["setup", "install", "local", "dev", "docker", "postgres", "seed"],
      },
      {
        href: "/docs/developers/env",
        label: "Environment variables",
        summary: "Every variable the app reads, what it is for, and where to get its value.",
        keywords: ["env", "environment", "variables", "secrets", "config", "dotenv"],
      },
      {
        href: "/docs/developers/structure",
        label: "Project structure",
        summary: "Route groups, colocation rules, and where a new file belongs.",
        keywords: ["structure", "folders", "layout", "conventions", "route groups"],
      },
      {
        href: "/docs/developers/strings",
        label: "The strings rule",
        summary: "No hardcoded copy, no em dashes, and the CI gate that enforces both.",
        keywords: ["strings", "copy", "i18n", "t()", "check-strings", "em dash", "overrides"],
      },
      {
        href: "/docs/developers/design-system",
        label: "Design system",
        summary: "The token set, the custom dark variant, and the editorial utilities.",
        keywords: ["design", "tokens", "css", "tailwind", "colors", "oklch", "fonts", "globals.css"],
      },
      {
        href: "/docs/developers/components",
        label: "UI components",
        summary: "shadcn base-nova on Base UI, the variants, and the select gotcha.",
        keywords: ["components", "shadcn", "base ui", "radix", "button", "select", "ui"],
      },
      {
        href: "/docs/developers/theming",
        label: "Theming",
        summary: "next-themes, the theme cookie, per-area toggles and portal theming.",
        keywords: ["theme", "dark mode", "light", "next-themes", "cookie", "toggle"],
      },
      {
        href: "/docs/developers/data-model",
        label: "Data model",
        summary: "Prisma 7, the driver adapter, the model groups and the migration workflow.",
        keywords: ["prisma", "database", "schema", "models", "postgres", "migration", "enum"],
      },
      {
        href: "/docs/developers/auth",
        label: "Authentication",
        summary: "NextAuth v5, JWT sessions, the edge proxy, and session invalidation.",
        keywords: ["auth", "nextauth", "session", "jwt", "login", "magic link", "proxy"],
      },
      {
        href: "/docs/developers/authorization",
        label: "Authorization",
        summary: "Route gates, server guards, safe redirects and the recruitment capability matrix.",
        keywords: ["authz", "permissions", "guards", "requireAdmin", "capability", "roles"],
      },
      {
        href: "/docs/developers/server-actions",
        label: "Server actions",
        summary: "The shape every mutation follows: validate, guard, transact, audit, revalidate.",
        keywords: ["server action", "mutation", "zod", "form", "use server", "pattern"],
      },
      {
        href: "/docs/developers/settings",
        label: "Settings and content",
        summary: "The Setting table, the content schema, and how event mode is derived.",
        keywords: ["settings", "content", "config", "event state", "mode", "getContent"],
      },
      {
        href: "/docs/developers/payments",
        label: "Payments",
        summary: "The provider abstraction, the Razorpay webhook, and the UPI fallback.",
        keywords: ["payment", "razorpay", "upi", "webhook", "signature", "provider"],
      },
      {
        href: "/docs/developers/email",
        label: "Email",
        summary: "Resend or SES, React Email templates, the delivery log and the staging sink.",
        keywords: ["email", "resend", "react email", "template", "emaillog", "staging"],
      },
      {
        href: "/docs/developers/media",
        label: "Media and uploads",
        summary: "Two-phase presigned S3 uploads, the public prefixes, team photos, and the orphan sweep.",
        keywords: ["media", "upload", "s3", "presign", "image", "storage", "sweep"],
      },
      {
        href: "/docs/developers/intake",
        label: "The intake pipeline",
        summary: "Four ways a delegate row is created, all through one function.",
        keywords: ["intake", "import", "webhook", "gform", "quarantine", "createDelegateFromRow"],
      },
      {
        href: "/docs/developers/quiz",
        label: "The quiz system",
        summary: "Server-authoritative timing, realtime, scoring and sealed result receipts.",
        keywords: ["quiz", "realtime", "sse", "event source", "scoring", "receipt", "session", "slides"],
      },
      {
        href: "/docs/developers/audit",
        label: "Audit and rollback",
        summary: "What gets recorded, how the diff is stored, and how rollback replays it.",
        keywords: ["audit", "log", "rollback", "history", "diff"],
      },
      {
        href: "/docs/developers/cron",
        label: "Cron jobs",
        summary: "Three scheduled routes, how they authenticate and how they stay idempotent.",
        keywords: ["cron", "scheduled", "github actions", "cron_enabled", "reminder", "sweep", "sync"],
      },
      {
        href: "/docs/developers/security",
        label: "Security posture",
        summary: "Headers, the report-only CSP and how to promote it, rate limits, and the admin invariant.",
        keywords: ["security", "csp", "headers", "rate limit", "xss", "clickjacking"],
      },
      {
        href: "/docs/developers/testing",
        label: "Testing",
        summary: "There is no test framework. There are thirty-six assertion scripts and a strings gate. Here is why.",
        keywords: ["test", "testing", "check", "assert", "jest", "vitest", "scripts"],
      },
      {
        href: "/docs/developers/ci",
        label: "CI and deployment",
        summary: "The workflows, the deploy pipeline to AWS, and what happens on a push to staging or main.",
        keywords: ["ci", "deploy", "aws", "lightsail", "docker", "caddy", "github actions", "rollback", "migration"],
      },
      {
        href: "/docs/developers/api",
        label: "API reference",
        summary: "Every route handler: method, auth, payload and response.",
        keywords: ["api", "routes", "endpoints", "webhook", "handler", "rest"],
      },
      {
        href: "/docs/developers/contributing",
        label: "Contributing",
        summary: "Branching, the checks you must run, and what a good pull request looks like.",
        keywords: ["contributing", "pr", "pull request", "branch", "commit", "review"],
      },
      {
        href: "/docs/developers/troubleshooting",
        label: "Troubleshooting",
        summary: "The errors you will actually hit locally, and what each one means.",
        keywords: ["error", "problem", "p1001", "prisma", "build fails", "debug"],
      },
    ],
  },
]

export const ALL_PAGES: DocPage[] = SECTIONS.flatMap((s) => s.pages)

export function sectionFor(href: string): DocSection | undefined {
  return SECTIONS.find((s) => s.pages.some((p) => p.href === href))
}

export function pageFor(href: string): DocPage | undefined {
  return ALL_PAGES.find((p) => p.href === href)
}

/** Previous and next page in reading order, across section boundaries. */
export function neighbours(href: string): { prev?: DocPage; next?: DocPage } {
  const i = ALL_PAGES.findIndex((p) => p.href === href)
  if (i < 0) return {}
  return { prev: ALL_PAGES[i - 1], next: ALL_PAGES[i + 1] }
}

export function searchPages(query: string): DocPage[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const terms = q.split(/\s+/)
  return ALL_PAGES.map((page) => {
    const haystack = [page.label, page.summary, ...(page.keywords ?? [])]
      .join(" ")
      .toLowerCase()
    // Every term must appear somewhere. Label hits outrank summary hits so
    // typing "payment" surfaces the payment page above the six that mention it.
    if (!terms.every((t) => haystack.includes(t))) return null
    const label = page.label.toLowerCase()
    const score = terms.reduce((acc, t) => acc + (label.includes(t) ? 2 : 0), 0)
    return { page, score }
  })
    .filter((r): r is { page: DocPage; score: number } => r !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((r) => r.page)
}
