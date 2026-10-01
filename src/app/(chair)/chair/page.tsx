import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { t } from "@/content/strings"
import { myChairedCommittees } from "@/lib/committee/viewer"
import { CommitteeChat } from "@/components/committee/committee-chat"
import { CommitteeFloor } from "@/components/committee/committee-floor"
import { CommitteeVideo } from "@/components/committee/committee-video"
import { daisSendMessage, moderateMessage, setHoldDirectMessages } from "./chat-actions"
import { floorDaisAction } from "./floor-actions"
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

  // Only seated delegations: an empty seat has nobody to message, hear or count.
  const seats = await prisma.portfolio.findMany({
    where: { committeeId: committee.id, allotment: { isNot: null } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <SessionWatch committeeId={committee.id} />
      <div className="space-y-1">
        <h1 className="display text-3xl">{committee.name}</h1>
        <p className="text-sm text-muted-foreground">{t("chair.pageDescription")}</p>
      </div>
      {switcher}
      <CommitteeVideo key={`video-${committee.id}`} committeeId={committee.id} mode="dais" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <CommitteeChat
          key={committee.id}
          committeeId={committee.id}
          mode="dais"
          seats={seats}
          holdDirectMessages={committee.holdDirectMessages}
          send={daisSendMessage}
          moderate={moderateMessage}
          setHold={setHoldDirectMessages}
        />
        <CommitteeFloor
          key={`floor-${committee.id}`}
          committeeId={committee.id}
          mode="dais"
          seats={seats}
          daisAction={floorDaisAction}
        />
      </div>
    </main>
  )
}
