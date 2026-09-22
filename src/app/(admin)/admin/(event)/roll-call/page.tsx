import { prisma } from "@/lib/prisma"
import { currentEventScope } from "@/lib/event"
import { t } from "@/content/strings"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { RollCallClient, type RollCallSeat } from "./_components/roll-call-client"
import { CommitteeChat } from "@/components/committee/committee-chat"
import { daisSendMessage, moderateMessage, setHoldDirectMessages } from "./chat-actions"
import { CommitteeFloor } from "@/components/committee/committee-floor"
import { floorDaisAction } from "./floor-actions"

// Roll call only applies where the committee actually meets online. An in-person
// committee takes attendance at the door (admin/checkin), not here.
const ONLINE_FORMATS = ["ONLINE", "HYBRID"] as const

export default async function RollCallPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await props.searchParams
  const raw = params.committee
  const selectedId = Array.isArray(raw) ? raw[0] : raw

  const scope = await currentEventScope()

  const committees = await prisma.committee.findMany({
    where: { ...scope, isActive: true, format: { in: [...ONLINE_FORMATS] } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, format: true, holdDirectMessages: true },
  })

  const committee = committees.find((c) => c.id === selectedId) ?? committees[0] ?? null

  // The live session, if one is open. A COMPLETED session is deliberately not
  // picked up: the screen should offer a fresh roll call rather than silently
  // reopening a closed one.
  const session = committee
    ? await prisma.committeeSession.findFirst({
        where: { committeeId: committee.id, state: { in: ["NOT_STARTED", "ACTIVE", "PAUSED"] } },
        orderBy: { attempt: "desc" },
        select: { id: true, attempt: true, version: true, state: true },
      })
    : null

  // Seats come from Portfolio so that an unallotted seat still appears and still
  // counts toward the quorum denominator. Allotment reaches Delegate through the
  // relation added with this feature.
  const seats: RollCallSeat[] = committee
    ? (
        await prisma.portfolio.findMany({
          where: { committeeId: committee.id },
          orderBy: [{ priority: "desc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            allotment: { select: { delegate: { select: { fullName: true } } } },
            attendance: session
              ? {
                  where: { sessionId: session.id },
                  select: { status: true, markedAt: true, markedById: true },
                  take: 1,
                }
              : false,
          },
        })
      ).map((p) => {
        const row = Array.isArray(p.attendance) ? p.attendance[0] : undefined
        return {
          portfolioId: p.id,
          portfolioName: p.name,
          delegateName: p.allotment?.delegate?.fullName ?? null,
          status: row?.status ?? "EXPECTED",
          markedAt: row?.markedAt?.toISOString() ?? null,
          markedById: row?.markedById ?? null,
        }
      })
    : []

  return (
    <div className="space-y-8">
      <PageHeader title={t("rollCall.title")} description={t("rollCall.description")} />
      <RollCallClient
        committees={committees.map((c) => ({ id: c.id, name: c.name }))}
        selectedCommitteeId={committee?.id ?? null}
        session={session}
        seats={seats}
      />
      {committee && (
        <CommitteeFloor
          key={`floor-${committee.id}`}
          committeeId={committee.id}
          mode="dais"
          seats={seats.filter((s) => s.delegateName).map((s) => ({ id: s.portfolioId, name: s.portfolioName }))}
          daisAction={floorDaisAction}
        />
      )}
      {committee && (
        <CommitteeChat
          key={committee.id}
          committeeId={committee.id}
          mode="dais"
          seats={seats.filter((s) => s.delegateName).map((s) => ({ id: s.portfolioId, name: s.portfolioName }))}
          holdDirectMessages={committee.holdDirectMessages}
          send={daisSendMessage}
          moderate={moderateMessage}
          setHold={setHoldDirectMessages}
        />
      )}
    </div>
  )
}
