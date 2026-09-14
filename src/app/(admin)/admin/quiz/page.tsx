import { formatDate } from "@/lib/datetime"
import Link from "next/link"
import { ArrowUpRight, BarChart3, Clock3, Plus, Presentation, RadioTower, Sparkles } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { t } from "@/content/strings"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { ArchivePresentation, DeletePresentation } from "./_components/delete-presentation"
import { createPresentation } from "./actions"

export default async function AdminQuizPage(props: { searchParams: Promise<{ view?: string }> }) {
  const archivedView = (await props.searchParams).view === "archived"
  const [presentations, activeCount, archivedCount] = await Promise.all([
    prisma.presentation.findMany({
      where: { archivedAt: archivedView ? { not: null } : null },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, mode: true, createdAt: true, archivedAt: true, _count: { select: { slides: true } } },
    }),
    prisma.presentation.count({ where: { archivedAt: null } }),
    prisma.presentation.count({ where: { archivedAt: { not: null } } }),
  ])
  const totalSlides = presentations.reduce((sum, presentation) => sum + presentation._count.slides, 0)

  // A run counts once somebody answered in it. Opening the presenter alone
  // creates an empty lobby session, which is not a result worth listing.
  const sessions = await prisma.quizSession.findMany({
    where: { presentationId: { in: presentations.map((p) => p.id) } },
    select: { id: true, presentationId: true },
  })
  const answered = new Set(
    (await prisma.response.groupBy({ by: ["sessionId"], where: { sessionId: { in: sessions.map((s) => s.id) } } })).map(
      (r) => r.sessionId,
    ),
  )
  const runsFor = (id: string) => sessions.filter((s) => s.presentationId === id && answered.has(s.id)).length

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Live studio" title="Quiz control room" description="Build the show, rehearse the sequence, then put the audience live." />

      <section className="grid overflow-hidden border border-foreground/15 bg-ink text-paper lg:grid-cols-[1.2fr_0.8fr]">
        <div className="p-7 sm:p-9">
          <RadioTower className="size-8 text-primary" />
          <p className="mt-12 font-mono text-xs uppercase tracking-[0.2em] text-paper/50">New broadcast</p>
          <h2 className="mt-3 max-w-[12ch] font-heading text-4xl leading-tight sm:text-5xl">Build something the room can feel.</h2>
          <form action={createPresentation}>
            <button type="submit" className="mt-8 inline-flex h-13 items-center gap-2 bg-primary px-6 text-base font-bold text-primary-foreground transition-opacity hover:opacity-90">
              <Plus /> New presentation
            </button>
          </form>
        </div>
        <div className="grid grid-cols-2 border-t border-paper/15 lg:border-l lg:border-t-0">
          <div className="flex flex-col justify-end border-r border-paper/15 p-6">
            <span className="font-heading text-5xl">{activeCount}</span>
            <span className="mt-2 text-sm text-paper/55">Shows built</span>
          </div>
          <div className="flex flex-col justify-end p-6">
            <span className="font-heading text-5xl">{totalSlides}</span>
            <span className="mt-2 text-sm text-paper/55">{archivedView ? "Slides archived" : "Slides ready"}</span>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div><p className="eyebrow">Library</p><h2 className="mt-2 font-heading text-3xl">{archivedView ? "Archived shows" : "Your shows"}</h2></div>
          <nav className="flex gap-1 text-sm">
            {[
              { href: "/admin/quiz", label: `Active (${activeCount})`, on: !archivedView },
              { href: "/admin/quiz?view=archived", label: `Archived (${archivedCount})`, on: archivedView },
            ].map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={tab.on ? "page" : undefined}
                className={cn(
                  "border px-3 py-2 transition-colors",
                  tab.on ? "border-border bg-accent font-semibold" : "border-transparent text-muted-foreground hover:bg-muted",
                )}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>
        {presentations.length === 0 ? (
          <div className="border border-dashed border-border p-16 text-center">
            <Sparkles className="mx-auto size-8 text-primary" />
            <p className="mt-5 text-xl font-semibold">{archivedView ? "Nothing archived." : "The studio is empty."}</p>
            <p className="mt-2 text-base text-muted-foreground">
              {archivedView ? "Archive a show to move it off the main library without losing its results." : "Build the first interactive room."}
            </p>
          </div>
        ) : (
          <div className="grid gap-px overflow-hidden border border-border bg-border md:grid-cols-2 xl:grid-cols-3">
            {presentations.map((presentation, index) => {
              const runs = runsFor(presentation.id)
              return (
                <div key={presentation.id} className="group relative min-h-72 bg-background transition-colors hover:bg-muted/70">
                  <div className="absolute right-5 top-5 z-10 flex items-center gap-1">
                    <Link
                      href={`/admin/quiz/${presentation.id}/results`}
                      aria-label={`Results for ${presentation.title}`}
                      title="Results"
                      className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <BarChart3 className="size-4" />
                    </Link>
                    <ArchivePresentation id={presentation.id} title={presentation.title} archived={!!presentation.archivedAt} />
                    <DeletePresentation id={presentation.id} title={presentation.title} runs={runs} />
                  </div>
                  <Link href={"/admin/quiz/" + presentation.id} className="block h-full p-6">
                    <div className="flex items-start justify-between">
                      <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")} / SHOW</span>
                      <ArrowUpRight className="mr-28 size-5 transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" />
                    </div>
                    <Presentation className="mt-10 size-7 text-primary" />
                    <h3 className="mt-5 font-heading text-3xl leading-tight">{presentation.title}</h3>
                    <div className="mt-8 flex flex-wrap gap-2">
                      <span className="bg-ink px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-paper">{t(("quiz.modes." + presentation.mode) as Parameters<typeof t>[0])}</span>
                      <span className="bg-muted px-2.5 py-1 text-xs">{presentation._count.slides} slides</span>
                      {runs > 0 && <span className="bg-muted px-2.5 py-1 text-xs">{runs} run{runs === 1 ? "" : "s"}</span>}
                    </div>
                    <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock3 className="size-4" />
                      {formatDate(presentation.createdAt)}
                    </p>
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
