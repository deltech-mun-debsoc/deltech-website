import Link from "next/link"
import { notFound } from "next/navigation"
import { Download } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/authz"
import { formatDate } from "@/lib/datetime"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { buttonVariants } from "@/components/ui/button"
import { DeleteRun } from "../../_components/delete-presentation"

// Every run of one show, newest first, with its final standings. A run is one
// room code; its answers stay here until someone deletes the run or the show.
export default async function QuizResultsPage(props: { params: Promise<{ id: string }> }) {
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"
  const { id } = await props.params

  const presentation = await prisma.presentation.findUnique({
    where: { id },
    select: { id: true, title: true, mode: true, _count: { select: { slides: true } } },
  })
  if (!presentation) notFound()

  const sessions = await prisma.quizSession.findMany({
    where: { presentationId: id },
    orderBy: [{ startedAt: { sort: "desc", nulls: "last" } }, { roomCode: "asc" }],
    select: { id: true, roomCode: true, status: true, startedAt: true, endedAt: true },
  })
  const standings = await prisma.response.groupBy({
    by: ["sessionId", "nickname"],
    where: { sessionId: { in: sessions.map((s) => s.id) } },
    _sum: { points: true },
    _count: { _all: true },
    _max: { avatar: true },
  })
  const runs = sessions
    .map((s) => ({
      ...s,
      players: standings
        .filter((r) => r.sessionId === s.id)
        .sort((a, b) => (b._sum.points ?? 0) - (a._sum.points ?? 0)),
    }))
    .filter((r) => r.players.length > 0)

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Quiz · results"
        title={presentation.title}
        description={`${runs.length} run${runs.length === 1 ? "" : "s"} with answers · ${presentation._count.slides} slides`}
      >
        <Link href="/admin/quiz" className={buttonVariants({ variant: "outline" })}>All shows</Link>
        <Link href={`/admin/quiz/${id}`} className={buttonVariants({ variant: "outline" })}>Edit show</Link>
      </PageHeader>

      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody has answered in this show yet.</p>
      ) : (
        runs.map((run) => {
          const answers = run.players.reduce((n, p) => n + p._count._all, 0)
          const label = `room ${run.roomCode}${run.startedAt ? ` on ${formatDate(run.startedAt)}` : ""}`
          return (
            <section key={run.id} className="editorial-card space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-heading text-2xl">{run.startedAt ? formatDate(run.startedAt) : "Not started"}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Room {run.roomCode} · {run.status} · {run.players.length} {presentation.mode === "QUIZ" ? "players" : "respondents"} · {answers} answers
                  </p>
                </div>
                <div className="flex gap-2">
                  <a
                    href={`/api/admin/export?entity=quiz-run&sessionId=${run.id}&format=csv`}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    <Download className="size-4" /> CSV
                  </a>
                  {isAdmin && <DeleteRun id={run.id} label={label} />}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Name</th>
                      <th className="py-2 pr-3 text-right">Answers</th>
                      <th className="py-2 text-right">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.players.map((p, i) => (
                      <tr key={p.nickname ?? "anonymous"} className="border-t border-border/60">
                        <td className="py-2 pr-3 tabular-nums">{i + 1}</td>
                        <td className="py-2 pr-3">
                          {p._max.avatar ? `${p._max.avatar} ` : ""}
                          {p.nickname ?? "Anonymous votes"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p._count._all}</td>
                        <td className="py-2 text-right tabular-nums">{p._sum.points ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
