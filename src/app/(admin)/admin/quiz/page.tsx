import { formatDate } from "@/lib/datetime"
import Link from "next/link"
import { ArrowUpRight, Clock3, Plus, Presentation, RadioTower, Sparkles } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { t } from "@/content/strings"
import { PageHeader } from "@/app/(admin)/_components/page-header"

export default async function AdminQuizPage() {
  const presentations = await prisma.presentation.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, mode: true, createdAt: true, _count: { select: { slides: true } } },
  })
  const totalSlides = presentations.reduce((sum, presentation) => sum + presentation._count.slides, 0)

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Live studio" title="Quiz control room" description="Build the show, rehearse the sequence, then put the audience live." />

      <section className="grid overflow-hidden border border-foreground/15 bg-foreground text-background lg:grid-cols-[1.2fr_0.8fr]">
        <div className="p-7 sm:p-9">
          <RadioTower className="size-8 text-primary" />
          <p className="mt-12 font-mono text-xs uppercase tracking-[0.2em] text-background/50">New broadcast</p>
          <h2 className="mt-3 max-w-[12ch] font-heading text-4xl leading-tight sm:text-5xl">Build something the room can feel.</h2>
          <Link href="/admin/quiz/new" className="mt-8 inline-flex h-13 items-center gap-2 bg-primary px-6 text-base font-bold text-primary-foreground transition-opacity hover:opacity-90">
            <Plus /> New presentation
          </Link>
        </div>
        <div className="grid grid-cols-2 border-t border-background/15 lg:border-l lg:border-t-0">
          <div className="flex flex-col justify-end border-r border-background/15 p-6">
            <span className="font-heading text-5xl">{presentations.length}</span>
            <span className="mt-2 text-sm text-background/55">Shows built</span>
          </div>
          <div className="flex flex-col justify-end p-6">
            <span className="font-heading text-5xl">{totalSlides}</span>
            <span className="mt-2 text-sm text-background/55">Slides ready</span>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-5 flex items-end justify-between">
          <div><p className="eyebrow">Library</p><h2 className="mt-2 font-heading text-3xl">Your shows</h2></div>
          <p className="hidden text-sm text-muted-foreground sm:block">Open one to edit or present</p>
        </div>
        {presentations.length === 0 ? (
          <div className="border border-dashed border-border p-16 text-center">
            <Sparkles className="mx-auto size-8 text-primary" />
            <p className="mt-5 text-xl font-semibold">The studio is empty.</p>
            <p className="mt-2 text-base text-muted-foreground">Build the first interactive room.</p>
          </div>
        ) : (
          <div className="grid gap-px overflow-hidden border border-border bg-border md:grid-cols-2 xl:grid-cols-3">
            {presentations.map((presentation, index) => (
              <Link key={presentation.id} href={"/admin/quiz/" + presentation.id} className="group min-h-72 bg-background p-6 transition-colors hover:bg-[#edf7f4]">
                <div className="flex items-start justify-between">
                  <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")} / SHOW</span>
                  <ArrowUpRight className="size-5 transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" />
                </div>
                <Presentation className="mt-10 size-7 text-primary" />
                <h3 className="mt-5 font-heading text-3xl leading-tight">{presentation.title}</h3>
                <div className="mt-8 flex flex-wrap gap-2">
                  <span className="bg-foreground px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-background">{t(("quiz.modes." + presentation.mode) as Parameters<typeof t>[0])}</span>
                  <span className="bg-muted px-2.5 py-1 text-xs">{presentation._count.slides} slides</span>
                </div>
                <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock3 className="size-4" />
                  {formatDate(presentation.createdAt)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
