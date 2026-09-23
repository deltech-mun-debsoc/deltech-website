import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { t } from "@/content/strings"
import { myChairedCommittees } from "@/lib/committee/viewer"
import { CommitteeChat } from "@/components/committee/committee-chat"
import { CommitteeFloor } from "@/components/committee/committee-floor"
import { CommitteeVideo } from "@/components/committee/committee-video"
import { daisSendMessage, moderateMessage, setHoldDirectMessages } from "./chat-actions"
import { floorDaisAction } from "./floor-actions"
import { RollCall, type RollCallSeat } from "./_components/roll-call"
import { SessionWatch } from "./_components/session-watch"

export default async function ChairPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await props.searchParams
  const raw = Array.isArray(params.c) ? params.c[0] : params.c

  const committees = await myChairedCommittees()
  const committee = committees.find((c) => c.id === raw) ?? committees[0] ?? null

  if (!committee) {
    return (
      <main className="mx-auto max-w-lg space-y-3 px-6 py-20 text-center">
        <SessionWatch committeeId={null} />
        <h1 className="display text-3xl">{t("chair.unassignedTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("chair.unassignedBody")}</p>
      </main>
    )
  }

  // Only an ACTIVE session is the chair's to run. The secretariat opens it; until
  // then the page waits, and SessionWatch moves it on when that happens.
  const session = await prisma.committeeSession.findFirst({
    where: { committeeId: committee.id, state: "ACTIVE" },
    orderBy: { attempt: "desc" },
    select: { id: true },
  })

  const switcher = committees.length > 1 && (
    <nav aria-label={t("chair.otherCommittees")} className="flex flex-wrap gap-3 text-sm">
      {committees.map((c) => (
        <Link
          key={c.id}
          href={`/chair?c=${c.id}`}
          className={c.id === committee.id ? "font-semibold underline" : "text-muted-foreground"}
        >
          {c.name}
        </Link>
      ))}
    </nav>
  )

  if (!session) {
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <SessionWatch committeeId={committee.id} />
        <h1 className="display text-3xl">{committee.name}</h1>
        {switcher}
        <div className="space-y-1 rounded-lg border border-border/70 p-6">
          <h2 className="font-heading text-xl">{t("chair.waitingTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("chair.waitingBody")}</p>
        </div>
      </main>
    )
  }

  // Seats come from Portfolio so an unallotted seat still appears and still
  // counts toward the quorum denominator.
  const seats: RollCallSeat[] = (
    await prisma.portfolio.findMany({
      where: { committeeId: committee.id },
      orderBy: [{ priority: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        allotment: { select: { delegate: { select: { fullName: true } } } },
        attendance: {
          where: { sessionId: session.id },
          select: { status: true, markedAt: true, markedById: true },
          take: 1,
        },
      },
    })
  ).map((p) => ({
    portfolioId: p.id,
    portfolioName: p.name,
    delegateName: p.allotment?.delegate?.fullName ?? null,
    status: p.attendance[0]?.status ?? "EXPECTED",
    markedAt: p.attendance[0]?.markedAt?.toISOString() ?? null,
    markedById: p.attendance[0]?.markedById ?? null,
  }))
  const allotted = seats.filter((s) => s.delegateName).map((s) => ({ id: s.portfolioId, name: s.portfolioName }))

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <SessionWatch committeeId={committee.id} />
      <div className="space-y-1">
        <h1 className="display text-3xl">{committee.name}</h1>
        <p className="text-sm text-muted-foreground">{t("chair.pageDescription")}</p>
      </div>
      {switcher}
      <RollCall sessionId={session.id} seats={seats} />
      <CommitteeVideo key={`video-${committee.id}`} committeeId={committee.id} mode="dais" />
      <CommitteeFloor
        key={`floor-${committee.id}`}
        committeeId={committee.id}
        mode="dais"
        seats={allotted}
        daisAction={floorDaisAction}
      />
      <CommitteeChat
        key={committee.id}
        committeeId={committee.id}
        mode="dais"
        seats={allotted}
        holdDirectMessages={committee.holdDirectMessages}
        send={daisSendMessage}
        moderate={moderateMessage}
        setHold={setHoldDirectMessages}
      />
    </main>
  )
}
