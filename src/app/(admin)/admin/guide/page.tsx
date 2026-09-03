import Link from "next/link"
import {
  ArrowRight,
  BookOpenText,
  Check,
  CircleAlert,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react"
import { requireStaff } from "@/lib/authz"
import { PageHeader } from "../../_components/page-header"

const LAUNCH_SEQUENCE = [
  { title: "Publish the conference brief", body: "Set dates, venue, hero copy, contacts, awards, and the public matrix visibility.", href: "/admin/config/conference", label: "Conference settings" },
  { title: "Build committees and portfolios", body: "Create each committee, write the agenda, set delegation type, then generate or paste the portfolio roster.", href: "/admin/config/committees", label: "Committees and matrix" },
  { title: "Set fees and payment routing", body: "Confirm every fee tier. Payment provider and reconciliation settings require an admin.", href: "/admin/config/money", label: "Money settings" },
  { title: "Quality-check the public experience", body: "Review the homepage, live matrix, team roster, dispatch, and the full registration form on mobile.", href: "/", label: "Open public site" },
  { title: "Open delegate intake", body: "Only open registration after the public copy, committees, portfolios, fees, and payment path are ready.", href: "/admin/config/registration", label: "Registration control" },
  { title: "Watch the first submissions", body: "Verify delegate records, source attribution, confirmation email delivery, and any quarantined imports.", href: "/admin/registrations", label: "Registration desk" },
]

const DAILY_WORK = [
  { title: "Registration desk", body: "Search and correct delegate details. Use filters before exports or bulk review.", href: "/admin/registrations" },
  { title: "Allotment floor", body: "Match delegates deliberately. Holds are temporary; confirmed allotments trigger the payment brief.", href: "/admin/allotment" },
  { title: "Cross-delegation imports", body: "Map columns, inspect the preview, commit clean rows, then resolve the quarantine queue.", href: "/admin/import" },
  { title: "Publishing desk", body: "Moderate dispatches, build live quizzes, and keep the public team roster current.", href: "/admin/blog" },
]

const PERMISSIONS = [
  ["Edit delegate details", true, true],
  ["Create or update committees and portfolios", true, true],
  ["Allot an available portfolio", true, true],
  ["Open or close registration", true, true],
  ["Run imports, recruitment, content, and team updates", true, true],
  ["Delete records", false, true],
  ["Revoke an allotment", false, true],
  ["Mark paid offline, comp, or cancel a delegate", false, true],
  ["Change payment routing or user roles", false, true],
] as const

export default async function OperatorGuidePage() {
  const session = await requireStaff()
  const role = (session.user as { role?: string }).role ?? "MAINTAINER"

  return (
    <div className="space-y-12 pb-12">
      <PageHeader
        eyebrow="Secretariat operations"
        title="Operator guide"
        description="The launch order, daily workflows, guardrails, and recovery path for running this platform without guessing."
      >
        <span className="data-label border border-primary/25 bg-primary/5 px-3 py-2 text-primary">Signed in as {role.toLowerCase()}</span>
      </PageHeader>

      <section className="relative overflow-hidden bg-ink p-7 text-paper sm:p-10">
        <div className="paper-grid absolute inset-0 opacity-[0.08]" aria-hidden />
        <div className="relative grid gap-10 lg:grid-cols-[1fr_0.72fr] lg:items-end">
          <div>
            <p className="data-label flex items-center gap-2 text-gold-300"><BookOpenText className="size-4" /> Start here</p>
            <h2 className="mt-5 max-w-3xl font-heading text-4xl leading-tight sm:text-5xl">Operate in sequence. Verify before you publish. Escalate destructive work.</h2>
          </div>
          <p className="text-base leading-relaxed text-paper/68">The platform is designed so maintainers can run normal conference operations while the highest-risk actions remain admin-only. If a control is missing or disabled, check the permission map below before treating it as a bug.</p>
        </div>
      </section>

      <section>
        <div className="mb-7 flex items-end justify-between gap-4 border-b border-foreground/20 pb-5">
          <div>
            <p className="data-label text-primary">01 · Launch runbook</p>
            <h2 className="mt-3 font-heading text-4xl">Build the conference in this order</h2>
          </div>
        </div>
        <ol>
          {LAUNCH_SEQUENCE.map((item, index) => (
            <li key={item.title} className="grid gap-5 border-b border-foreground/20 py-7 md:grid-cols-[4rem_1fr_auto] md:items-center">
              <span className="font-mono text-sm font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3 className="font-heading text-2xl">{item.title}</h3>
                <p className="mt-2 max-w-3xl text-base leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
              <Link href={item.href} className="inline-flex items-center gap-2 font-semibold text-primary">{item.label} <ArrowRight className="size-4" /></Link>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <p className="data-label text-primary">02 · Daily desk</p>
        <h2 className="mt-3 font-heading text-4xl">The four operating surfaces</h2>
        <div className="mt-8 grid border-l border-t border-foreground/20 md:grid-cols-2">
          {DAILY_WORK.map((item, index) => (
            <Link key={item.title} href={item.href} className="group min-h-56 border-b border-r border-foreground/20 p-7 transition-colors hover:bg-primary/[0.045]">
              <span className="font-mono text-sm font-semibold text-primary">0{index + 1}</span>
              <h3 className="mt-8 font-heading text-3xl">{item.title}</h3>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">{item.body}</p>
              <ArrowRight className="mt-6 size-5 transition-transform group-hover:translate-x-1" />
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="grid gap-8 lg:grid-cols-[0.62fr_1fr]">
          <div>
            <p className="data-label flex items-center gap-2 text-primary"><ShieldCheck className="size-4" /> 03 · Permission map</p>
            <h2 className="mt-3 font-heading text-4xl">Know where the guardrail is</h2>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">Maintainers handle reversible conference work. Admins own destructive, financial, and identity-level changes.</p>
          </div>
          <div className="border-t border-foreground/20">
            <div className="grid grid-cols-[1fr_6rem_6rem] border-b border-foreground/20 py-3 data-label text-muted-foreground">
              <span>Action</span><span className="text-center">Maintainer</span><span className="text-center">Admin</span>
            </div>
            {PERMISSIONS.map(([label, maintainer, admin]) => (
              <div key={label} className="grid grid-cols-[1fr_6rem_6rem] items-center border-b border-foreground/20 py-4 text-sm sm:text-base">
                <span>{label}</span>
                <span className="flex justify-center">{maintainer ? <Check className="size-5 text-primary" /> : <LockKeyhole className="size-4 text-muted-foreground" />}</span>
                <span className="flex justify-center">{admin && <Check className="size-5 text-primary" />}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-l-4 border-l-gold-500 bg-accent p-7 sm:p-9">
        <p className="data-label flex items-center gap-2 text-accent-foreground"><CircleAlert className="size-4" /> 04 · When something goes wrong</p>
        <h2 className="mt-4 font-heading text-3xl">Stop the blast radius before fixing the record.</h2>
        <ol className="mt-6 grid gap-4 text-base leading-relaxed md:grid-cols-2">
          <li><strong>1. Pause intake if necessary.</strong> Close registration when new submissions would make the issue worse.</li>
          <li><strong>2. Read the activity log.</strong> Confirm who changed what and when before editing more data.</li>
          <li><strong>3. Prefer correction over deletion.</strong> Edit the record or ask an admin to perform a guarded destructive action.</li>
          <li><strong>4. Recheck the public surface.</strong> Verify the matrix, registration state, and delegate status after recovery.</li>
        </ol>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/admin/logs" className="inline-flex min-h-11 items-center gap-2 bg-ink px-5 py-3 font-semibold text-paper">Open activity log <ArrowRight className="size-4" /></Link>
          <Link href="/admin/config/registration" className="inline-flex min-h-11 items-center gap-2 border border-foreground/25 px-5 py-3 font-semibold">Registration control</Link>
        </div>
      </section>
    </div>
  )
}
