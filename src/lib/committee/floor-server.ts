import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { bus } from "@/lib/realtime/bus"
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit"
import { audit } from "@/lib/audit"
import { syncFloorRoom } from "@/lib/livekit/server"
import { t } from "@/content/strings"
import type { ChatViewer } from "./chat"
import {
  decideBallot,
  tallyBallots,
  votePasses,
  type BallotChoiceName,
  type DaisOp,
  type DelegateOp,
  type VoteKindName,
  type VoteMajorityName,
} from "./floor"

// Server side of the committee floor: the mic and votes. Callers authorise and
// resolve a viewer first; nothing here trusts an id or a role from the client.
//
// Concurrency, in one place:
// - Every dais operation runs in one transaction that first bumps
//   CommitteeSession.version conditionally. That UPDATE takes the session row's
//   lock, so two chairs acting at once are serialised, and the second finds the
//   version moved and is refused as stale. A refused or failed operation rolls
//   the bump back with everything else.
// - Delegates never take that lock. Their only write is a ballot, and the
//   database refuses a second one per delegation per vote.
// - A ballot takes FOR SHARE on its vote row before inserting; closing a vote
//   UPDATEs that row first and counts afterwards. The UPDATE waits for every
//   ballot already holding the share lock, and a ballot arriving after the UPDATE
//   waits, then sees CLOSED. So a ballot is either in the tally or refused, never
//   stored but uncounted.

export class FloorRefusal extends Error {}
class StaleVersion extends Error {}
const refuse = (key: Parameters<typeof t>[0]): never => {
  throw new FloorRefusal(t(key))
}

// Dais operations that change who may be seen and heard in the video room.
const MIC_OPS: ReadonlySet<DaisOp["op"]> = new Set(["giveMic", "takeMic"])

export function floorNudge(committeeId: string): void {
  bus.publish(`committee:${committeeId}`, "floor", null)
}

async function liveSession(committeeId: string) {
  return prisma.committeeSession.findFirst({
    where: { committeeId, state: "ACTIVE" },
    orderBy: { attempt: "desc" },
    select: { id: true, version: true, micPortfolioId: true },
  })
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface VoteView {
  id: string
  subject: string
  kind: VoteKindName
  majority: VoteMajorityName
  state: "OPEN" | "CLOSED"
  eligible: number
  cast: number
  /** Hidden from delegates while the vote is open, so a running count cannot sway it. */
  yes: number | null
  no: number | null
  abstain: number | null
  passed: boolean | null
  myChoice: BallotChoiceName | null
  /** Dais only: who voted what. */
  ballots: { portfolioName: string; choice: BallotChoiceName }[] | null
}

export interface FloorView {
  serverNow: string
  session: { id: string; version: number } | null
  /** The delegation holding the mic, if any. */
  mic: { portfolioId: string; name: string } | null
  me: { portfolioId: string } | null
  vote: VoteView | null
  lastVote: VoteView | null
}

export async function readFloor(viewer: ChatViewer, committeeId: string): Promise<FloorView> {
  const serverNow = new Date().toISOString()
  const session = await liveSession(committeeId)
  const me = viewer.kind === "delegate" ? { portfolioId: viewer.portfolioId } : null
  if (!session) return { serverNow, session: null, mic: null, me, vote: null, lastVote: null }

  const [holder, votes] = await Promise.all([
    session.micPortfolioId
      ? prisma.portfolio.findUnique({ where: { id: session.micPortfolioId }, select: { id: true, name: true } })
      : Promise.resolve(null),
    prisma.vote.findMany({
      where: { sessionId: session.id },
      orderBy: { openedAt: "desc" },
      take: 2,
      include: { ballots: { select: { portfolioId: true, choice: true, portfolio: { select: { name: true } } } } },
    }),
  ])

  const voteView = (v: (typeof votes)[number]): VoteView => {
    const open = v.state === "OPEN"
    const dais = viewer.kind === "dais"
    const live = tallyBallots(v.ballots.map((b) => b.choice))
    const mine = viewer.kind === "delegate" ? v.ballots.find((b) => b.portfolioId === viewer.portfolioId) : undefined
    const show = !open || dais
    return {
      id: v.id,
      subject: v.subject,
      kind: v.kind,
      majority: v.majority,
      state: v.state,
      eligible: v.eligible,
      cast: v.ballots.length,
      yes: show ? (open ? live.yes : v.yes) : null,
      no: show ? (open ? live.no : v.no) : null,
      abstain: show ? (open ? live.abstain : v.abstain) : null,
      passed: v.passed,
      myChoice: mine?.choice ?? null,
      ballots: dais ? v.ballots.map((b) => ({ portfolioName: b.portfolio.name, choice: b.choice })) : null,
    }
  }

  const open = votes.find((v) => v.state === "OPEN")
  const closed = votes.find((v) => v.state === "CLOSED")
  return {
    serverNow,
    session: { id: session.id, version: session.version },
    mic: holder ? { portfolioId: holder.id, name: holder.name } : null,
    me,
    vote: open ? voteView(open) : null,
    lastVote: closed ? voteView(closed) : null,
  }
}

// ---------------------------------------------------------------------------
// The dais
// ---------------------------------------------------------------------------

export type FloorResult = { success: true } | { success: false; error: string; stale?: boolean }

export async function runDaisOp(
  viewer: ChatViewer,
  committeeId: string,
  expectedVersion: number,
  op: DaisOp,
): Promise<FloorResult> {
  if (viewer.kind !== "dais") return { success: false, error: t("floor.errorNotAllowed") }
  const session = await liveSession(committeeId)
  if (!session) return { success: false, error: t("floor.errorNoSession") }

  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date()
      const bumped = await tx.committeeSession.updateMany({
        where: { id: session.id, version: expectedVersion, state: "ACTIVE" },
        data: { version: { increment: 1 }, lastActivityAt: now },
      })
      if (bumped.count === 0) throw new StaleVersion()
      const sid = session.id

      switch (op.op) {
        case "giveMic": {
          // Only a seat someone actually holds; an empty seat has nobody to hear.
          const seat = await tx.portfolio.findFirst({
            where: { id: op.portfolioId, committeeId, allotment: { isNot: null } },
            select: { id: true },
          })
          if (!seat) refuse("floor.errorSeat")
          await tx.committeeSession.update({ where: { id: sid }, data: { micPortfolioId: op.portfolioId } })
          return
        }

        case "takeMic":
          await tx.committeeSession.update({ where: { id: sid }, data: { micPortfolioId: null } })
          return

        case "openVote": {
          if (await tx.vote.findFirst({ where: { sessionId: sid, state: "OPEN" }, select: { id: true } })) {
            refuse("floor.errorVoteOpen")
          }
          await tx.vote.create({
            data: {
              sessionId: sid,
              subject: op.subject,
              kind: op.kind,
              majority: op.majority,
              // Every seated delegation may vote: attendance is the chair's sheet.
              eligible: await tx.portfolio.count({ where: { committeeId, allotment: { isNot: null } } }),
              openedById: viewer.email,
            },
          })
          return
        }

        case "closeVote": {
          // Take the vote row's write lock first. This waits for every ballot
          // currently holding FOR SHARE, and makes every later ballot wait and
          // then see CLOSED. Only after it do we count.
          const closed = await tx.$queryRaw<{ majority: VoteMajorityName }[]>`
            UPDATE "Vote" SET "state" = 'CLOSED', "closedAt" = ${now}, "closedById" = ${viewer.email}
            WHERE "id" = ${op.voteId} AND "sessionId" = ${sid} AND "state" = 'OPEN'
            RETURNING "majority"`
          if (closed.length === 0) refuse("floor.errorVoteClosed")
          const ballots = await tx.voteBallot.findMany({ where: { voteId: op.voteId }, select: { choice: true } })
          const tally = tallyBallots(ballots.map((b) => b.choice))
          await tx.vote.update({
            where: { id: op.voteId },
            data: { ...tally, passed: votePasses(closed[0].majority, tally.yes, tally.no) },
          })
          return
        }
      }
    })
  } catch (err) {
    if (err instanceof StaleVersion) return { success: false, error: t("floor.errorStale"), stale: true }
    if (err instanceof FloorRefusal) return { success: false, error: err.message }
    throw err
  }

  await audit(viewer.email, `floor_${op.op}`, "CommitteeSession", session.id, JSON.parse(JSON.stringify(op)))
  floorNudge(committeeId)
  // Not awaited: the chair's click must not wait on the SFU, and syncFloorRoom
  // never throws. The room converges within one LiveKit round trip.
  if (MIC_OPS.has(op.op)) void syncFloorRoom(committeeId)
  return { success: true }
}

// ---------------------------------------------------------------------------
// Delegates
// ---------------------------------------------------------------------------

export async function runDelegateOp(viewer: ChatViewer, committeeId: string, op: DelegateOp): Promise<FloorResult> {
  if (viewer.kind !== "delegate") return { success: false, error: t("floor.errorNotAllowed") }
  const limit = await rateLimit(RATE_LIMITS.committeeFloor, viewer.userId)
  if (!limit.ok) return { success: false, error: t("committeeChat.errorRateLimited", { s: limit.retryAfter }) }

  const session = await liveSession(committeeId)
  if (!session) return { success: false, error: t("floor.errorNoSession") }
  const sid = session.id

  try {
    await prisma.$transaction(async (tx) => {
      const vote = await tx.$queryRaw<{ kind: VoteKindName; state: string }[]>`
        SELECT "kind", "state" FROM "Vote"
        WHERE "id" = ${op.voteId} AND "sessionId" = ${sid}
        FOR SHARE`
      if (vote.length === 0) refuse("floor.errorGone")
      if (vote[0].state !== "OPEN") refuse("floor.errorVoteClosed")
      if (!decideBallot(vote[0].kind, op.choice).ok) refuse("floor.errorNoAbstainProcedural")
      await tx.voteBallot.create({
        data: {
          voteId: op.voteId,
          portfolioId: viewer.portfolioId,
          choice: op.choice,
          castById: viewer.userId,
          castByEmail: viewer.email,
        },
      })
    })
  } catch (err) {
    if (err instanceof FloorRefusal) return { success: false, error: err.message }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { success: false, error: t("floor.errorAlreadyVoted") }
    }
    throw err
  }

  floorNudge(committeeId)
  return { success: true }
}
