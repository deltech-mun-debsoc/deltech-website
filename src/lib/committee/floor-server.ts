import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { bus } from "@/lib/realtime/bus"
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit"
import { audit } from "@/lib/audit"
import { syncFloorRoom } from "@/lib/livekit/server"
import { t } from "@/content/strings"
import { isPresent, type CommitteeAttendanceName } from "./roll-call"
import type { ChatViewer } from "./chat"
import {
  decideBallot,
  decideMotion,
  endClock,
  isCaucus,
  liveKey,
  nextInLine,
  pauseClock,
  resumeClock,
  tallyBallots,
  votePasses,
  type BallotChoiceName,
  type Clock,
  type DaisOp,
  type DelegateOp,
  type MotionKindName,
  type MotionStateName,
  type VoteKindName,
  type VoteMajorityName,
} from "./floor"

// Server side of the committee floor. Callers authorise and resolve a viewer
// first; nothing here trusts an id or a role from the client.
//
// Concurrency, in one place:
// - Every dais operation runs in one transaction that first bumps
//   CommitteeSession.version conditionally. That UPDATE takes the session row's
//   lock, so two chairs acting at once are serialised, and the second finds the
//   version moved and is refused as stale. A refused or failed operation rolls
//   the bump back with everything else.
// - Delegates never take that lock. Their writes are their own rows, and the
//   database refuses duplicates (liveKey, one ballot per delegation per vote).
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

// Dais operations that change who holds the floor, and so who may be seen and
// heard in the video room.
const SPEAKER_OPS: ReadonlySet<DaisOp["op"]> = new Set(["nextSpeaker", "endSpeaker", "startCaucus", "endCaucus"])

export function floorNudge(committeeId: string): void {
  bus.publish(`committee:${committeeId}`, "floor", null)
}

async function liveSession(committeeId: string) {
  return prisma.committeeSession.findFirst({
    where: { committeeId, state: "ACTIVE" },
    orderBy: { attempt: "desc" },
    select: { id: true, version: true, gslSpeakingSeconds: true },
  })
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ClockView {
  allottedSeconds: number
  startedAt: string | null
  pausedAt: string | null
  pausedMs: number
  endedAt: string | null
}

export interface SpeakerView {
  id: string
  portfolioId: string
  portfolioName: string
  state: string
  clock: ClockView
}

export interface MotionView {
  id: string
  kind: MotionKindName
  state: MotionStateName
  proposerLabel: string
  mine: boolean
  topic: string | null
  totalSeconds: number | null
  speakingSeconds: number | null
  clock: ClockView | null
  speakers: SpeakerView[]
}

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
  session: { id: string; version: number; gslSpeakingSeconds: number } | null
  me: { portfolioId: string; attendance: CommitteeAttendanceName | null } | null
  gsl: SpeakerView[]
  caucus: MotionView | null
  motions: MotionView[]
  vote: VoteView | null
  lastVote: VoteView | null
}

const iso = (d: Date | null) => (d ? d.toISOString() : null)
const clockView = (c: Clock): ClockView => ({
  allottedSeconds: c.allottedSeconds,
  startedAt: iso(c.startedAt),
  pausedAt: iso(c.pausedAt),
  pausedMs: c.pausedMs,
  endedAt: iso(c.endedAt),
})

const LIVE_MOTIONS: MotionStateName[] = ["PROPOSED", "VOTING", "PASSED", "IN_PROGRESS"]

export async function readFloor(viewer: ChatViewer, committeeId: string): Promise<FloorView> {
  const serverNow = new Date().toISOString()
  const session = await liveSession(committeeId)
  const empty: FloorView = { serverNow, session: null, me: null, gsl: [], caucus: null, motions: [], vote: null, lastVote: null }
  if (!session) return empty

  const [speakers, motions, votes, attendance] = await Promise.all([
    prisma.speakerEntry.findMany({
      where: { sessionId: session.id, state: { in: ["QUEUED", "SPEAKING"] } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.motion.findMany({
      where: { sessionId: session.id, state: { in: LIVE_MOTIONS } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.vote.findMany({
      where: { sessionId: session.id },
      orderBy: { openedAt: "desc" },
      take: 2,
      include: { ballots: { select: { portfolioId: true, choice: true, portfolio: { select: { name: true } } } } },
    }),
    viewer.kind === "delegate"
      ? prisma.sessionAttendance.findUnique({
          where: { sessionId_portfolioId: { sessionId: session.id, portfolioId: viewer.portfolioId } },
          select: { status: true },
        })
      : Promise.resolve(null),
  ])

  const speakerView = (s: (typeof speakers)[number]): SpeakerView => ({
    id: s.id,
    portfolioId: s.portfolioId,
    portfolioName: s.portfolioName,
    state: s.state,
    clock: clockView(s),
  })
  const motionView = (m: (typeof motions)[number]): MotionView => ({
    id: m.id,
    kind: m.kind,
    state: m.state,
    proposerLabel: m.proposerLabel,
    mine: viewer.kind === "delegate" ? m.proposedByPortfolioId === viewer.portfolioId : m.proposedByPortfolioId === null,
    topic: m.topic,
    totalSeconds: m.totalSeconds,
    speakingSeconds: m.speakingSeconds,
    clock: m.totalSeconds ? clockView({ ...m, allottedSeconds: m.totalSeconds }) : null,
    speakers: speakers.filter((s) => s.motionId === m.id).map(speakerView),
  })
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
  const caucus = motions.find((m) => m.state === "IN_PROGRESS")

  return {
    serverNow,
    session,
    me: viewer.kind === "delegate" ? { portfolioId: viewer.portfolioId, attendance: attendance?.status ?? null } : null,
    gsl: speakers.filter((s) => s.motionId === null).map(speakerView),
    caucus: caucus ? motionView(caucus) : null,
    motions: motions.filter((m) => m.state !== "IN_PROGRESS").map(motionView),
    vote: open ? voteView(open) : null,
    lastVote: closed ? voteView(closed) : null,
  }
}

// ---------------------------------------------------------------------------
// The dais
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient

async function presentCount(tx: Tx, sessionId: string): Promise<number> {
  const rows = await tx.sessionAttendance.findMany({ where: { sessionId }, select: { status: true } })
  return rows.filter((r) => isPresent(r.status)).length
}

async function motionIn(tx: Tx, sessionId: string, motionId: string) {
  const m = await tx.motion.findFirst({ where: { id: motionId, sessionId } })
  return m ?? refuse("floor.errorGone")
}

/** The list a speaker action targets: the GSL, or a moderated caucus under way. */
async function listFor(tx: Tx, sessionId: string, motionId: string | null, gslSeconds: number) {
  if (motionId === null) return { motionId: null, speakingSeconds: gslSeconds }
  const m = await motionIn(tx, sessionId, motionId)
  if (m.kind !== "MODERATED_CAUCUS" || m.state !== "IN_PROGRESS" || !m.speakingSeconds) refuse("floor.errorNoList")
  return { motionId, speakingSeconds: m.speakingSeconds! }
}

async function nextPosition(tx: Tx, sessionId: string, motionId: string | null): Promise<number> {
  const last = await tx.speakerEntry.aggregate({ where: { sessionId, motionId }, _max: { position: true } })
  return (last._max.position ?? 0) + 1
}

async function endSpeaking(tx: Tx, sessionId: string, motionId: string | null, now: Date) {
  const current = await tx.speakerEntry.findFirst({ where: { sessionId, motionId, state: "SPEAKING" } })
  if (!current) return
  await tx.speakerEntry.update({
    where: { id: current.id },
    data: { ...(endClock(current, now) ?? {}), state: "SPOKEN", liveKey: null },
  })
}

async function entryIn(tx: Tx, sessionId: string, entryId: string) {
  const e = await tx.speakerEntry.findFirst({ where: { id: entryId, sessionId } })
  return e ?? refuse("floor.errorGone")
}

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
        case "setGslTime":
          await tx.committeeSession.update({ where: { id: sid }, data: { gslSpeakingSeconds: op.seconds } })
          return

        case "addSpeaker": {
          const list = await listFor(tx, sid, op.motionId, session.gslSpeakingSeconds)
          const seat = await tx.portfolio.findFirst({
            where: { id: op.portfolioId, committeeId, allotment: { isNot: null } },
            select: { name: true },
          })
          if (!seat) refuse("floor.errorSeat")
          await tx.speakerEntry.create({
            data: {
              sessionId: sid,
              motionId: list.motionId,
              portfolioId: op.portfolioId,
              portfolioName: seat!.name,
              liveKey: liveKey(sid, list.motionId, op.portfolioId),
              position: await nextPosition(tx, sid, list.motionId),
              allottedSeconds: list.speakingSeconds,
              addedById: viewer.email,
            },
          })
          return
        }

        case "removeSpeaker": {
          const e = await entryIn(tx, sid, op.entryId)
          if (e.state !== "QUEUED") refuse("floor.errorNotQueued")
          await tx.speakerEntry.update({ where: { id: e.id }, data: { state: "REMOVED", liveKey: null } })
          return
        }

        case "nextSpeaker": {
          const list = await listFor(tx, sid, op.motionId, session.gslSpeakingSeconds)
          await endSpeaking(tx, sid, list.motionId, now)
          const queued = await tx.speakerEntry.findMany({
            where: { sessionId: sid, motionId: list.motionId, state: "QUEUED" },
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          })
          const next = nextInLine(queued)
          // An empty list just ends the current speaker.
          if (next) {
            await tx.speakerEntry.update({
              where: { id: next.id },
              // Time is fixed when the speaker starts, so a change to the GSL time
              // applies to everyone who has not yet spoken.
              data: { state: "SPEAKING", startedAt: now, allottedSeconds: list.speakingSeconds },
            })
          }
          return
        }

        case "pauseSpeaker":
        case "resumeSpeaker":
        case "endSpeaker": {
          const e = await entryIn(tx, sid, op.entryId)
          if (e.state !== "SPEAKING") refuse("floor.errorNotSpeaking")
          const patch =
            op.op === "pauseSpeaker" ? pauseClock(e, now) : op.op === "resumeSpeaker" ? resumeClock(e, now) : endClock(e, now)
          if (!patch) refuse("floor.errorClock")
          await tx.speakerEntry.update({
            where: { id: e.id },
            data: op.op === "endSpeaker" ? { ...patch, state: "SPOKEN", liveKey: null } : patch!,
          })
          return
        }

        case "raiseMotion":
          await tx.motion.create({
            data: { sessionId: sid, ...op.draft, proposerLabel: t("committeeChat.daisLabel") },
          })
          return

        case "ruleOut":
        case "putToVote": {
          const m = await motionIn(tx, sid, op.motionId)
          const next = decideMotion(m, op.op)
          if (!next) refuse("floor.errorMotionState")
          if (op.op === "putToVote") {
            if (await tx.vote.findFirst({ where: { sessionId: sid, state: "OPEN" }, select: { id: true } })) {
              refuse("floor.errorVoteOpen")
            }
            await tx.vote.create({
              data: {
                sessionId: sid,
                motionId: m.id,
                subject: m.topic ? `${m.proposerLabel}: ${m.topic}` : m.proposerLabel,
                kind: "PROCEDURAL",
                majority: "SIMPLE",
                eligible: await presentCount(tx, sid),
                openedById: viewer.email,
              },
            })
          }
          await tx.motion.update({ where: { id: m.id }, data: { state: next! } })
          return
        }

        case "startCaucus": {
          const m = await motionIn(tx, sid, op.motionId)
          const next = decideMotion(m, "start")
          if (!next || !m.totalSeconds) refuse("floor.errorMotionState")
          if (await tx.motion.findFirst({ where: { sessionId: sid, state: "IN_PROGRESS" }, select: { id: true } })) {
            refuse("floor.errorCaucusRunning")
          }
          await tx.motion.update({ where: { id: m.id }, data: { state: next!, startedAt: now } })
          return
        }

        case "pauseCaucus":
        case "resumeCaucus": {
          const m = await motionIn(tx, sid, op.motionId)
          if (m.state !== "IN_PROGRESS" || !m.totalSeconds) refuse("floor.errorMotionState")
          const clock = { ...m, allottedSeconds: m.totalSeconds! }
          const patch = op.op === "pauseCaucus" ? pauseClock(clock, now) : resumeClock(clock, now)
          if (!patch) refuse("floor.errorClock")
          await tx.motion.update({ where: { id: m.id }, data: patch! })
          return
        }

        case "endCaucus": {
          const m = await motionIn(tx, sid, op.motionId)
          const next = decideMotion(m, "end")
          if (!next) refuse("floor.errorMotionState")
          const patch = m.totalSeconds ? endClock({ ...m, allottedSeconds: m.totalSeconds }, now) : null
          await tx.motion.update({ where: { id: m.id }, data: { ...(patch ?? {}), state: next!, endedAt: now } })
          // The caucus's own list goes with it: its speaker stops, its queue clears.
          await endSpeaking(tx, sid, m.id, now)
          await tx.speakerEntry.updateMany({
            where: { sessionId: sid, motionId: m.id, state: "QUEUED" },
            data: { state: "REMOVED", liveKey: null },
          })
          return
        }

        case "openVote": {
          if (await tx.vote.findFirst({ where: { sessionId: sid, state: "OPEN" }, select: { id: true } })) {
            refuse("floor.errorVoteOpen")
          }
          await tx.vote.create({
            data: {
              sessionId: sid,
              subject: op.subject,
              kind: "SUBSTANTIVE",
              majority: op.majority,
              eligible: await presentCount(tx, sid),
              openedById: viewer.email,
            },
          })
          return
        }

        case "closeVote": {
          // Take the vote row's write lock first. This waits for every ballot
          // currently holding FOR SHARE, and makes every later ballot wait and
          // then see CLOSED. Only after it do we count.
          const closed = await tx.$queryRaw<{ majority: VoteMajorityName; motionId: string | null }[]>`
            UPDATE "Vote" SET "state" = 'CLOSED', "closedAt" = ${now}, "closedById" = ${viewer.email}
            WHERE "id" = ${op.voteId} AND "sessionId" = ${sid} AND "state" = 'OPEN'
            RETURNING "majority", "motionId"`
          if (closed.length === 0) refuse("floor.errorVoteClosed")
          const { majority, motionId } = closed[0]
          const ballots = await tx.voteBallot.findMany({ where: { voteId: op.voteId }, select: { choice: true } })
          const tally = tallyBallots(ballots.map((b) => b.choice))
          const passed = votePasses(majority, tally.yes, tally.no)
          await tx.vote.update({ where: { id: op.voteId }, data: { ...tally, passed } })
          if (motionId) {
            const m = await motionIn(tx, sid, motionId)
            const next = decideMotion(m, passed ? "pass" : "fail")
            if (next) await tx.motion.update({ where: { id: m.id }, data: { state: next } })
          }
          return
        }
      }
    })
  } catch (err) {
    if (err instanceof StaleVersion) return { success: false, error: t("floor.errorStale"), stale: true }
    if (err instanceof FloorRefusal) return { success: false, error: err.message }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { success: false, error: t("floor.errorAlreadyQueued") }
    }
    throw err
  }

  if (op.op === "closeVote" || op.op === "openVote" || op.op === "putToVote") {
    await audit(viewer.email, `floor_${op.op}`, "CommitteeSession", session.id, JSON.parse(JSON.stringify(op)))
  }
  floorNudge(committeeId)
  // Not awaited: the chair's click must not wait on the SFU, and syncFloorRoom
  // never throws. The room converges within one LiveKit round trip.
  if (SPEAKER_OPS.has(op.op)) void syncFloorRoom(committeeId)
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
  const me = viewer.portfolioId
  const row = await prisma.sessionAttendance.findUnique({
    where: { sessionId_portfolioId: { sessionId: sid, portfolioId: me } },
    select: { status: true },
  })
  const attendance = row?.status ?? null

  try {
    switch (op.op) {
      case "requestToSpeak": {
        if (!attendance || !isPresent(attendance)) refuse("floor.errorNotPresent")
        await prisma.$transaction(async (tx) => {
          const list = await listFor(tx, sid, op.motionId, session.gslSpeakingSeconds)
          await tx.speakerEntry.create({
            data: {
              sessionId: sid,
              motionId: list.motionId,
              portfolioId: me,
              portfolioName: viewer.portfolioName,
              liveKey: liveKey(sid, list.motionId, me),
              position: await nextPosition(tx, sid, list.motionId),
              allottedSeconds: list.speakingSeconds,
              addedById: viewer.email,
            },
          })
        })
        break
      }

      case "withdrawRequest": {
        // Only a place still in the queue; someone already speaking is the dais's to end.
        const done = await prisma.speakerEntry.updateMany({
          where: { sessionId: sid, motionId: op.motionId, portfolioId: me, state: "QUEUED" },
          data: { state: "REMOVED", liveKey: null },
        })
        if (done.count === 0) refuse("floor.errorNotQueued")
        break
      }

      case "proposeMotion": {
        if (!attendance || !isPresent(attendance)) refuse("floor.errorNotPresent")
        // One pending motion per delegation keeps the dais's queue readable; the
        // rate limit covers the rest.
        const pending = await prisma.motion.count({ where: { sessionId: sid, proposedByPortfolioId: me, state: "PROPOSED" } })
        if (pending > 0) refuse("floor.errorOneMotion")
        await prisma.motion.create({
          data: { sessionId: sid, ...op.draft, proposedByPortfolioId: me, proposerLabel: viewer.portfolioName },
        })
        break
      }

      case "withdrawMotion": {
        const done = await prisma.motion.updateMany({
          where: { id: op.motionId, sessionId: sid, proposedByPortfolioId: me, state: "PROPOSED" },
          data: { state: "WITHDRAWN" },
        })
        if (done.count === 0) refuse("floor.errorMotionState")
        break
      }

      case "castBallot": {
        await prisma.$transaction(async (tx) => {
          const vote = await tx.$queryRaw<{ kind: VoteKindName; state: string }[]>`
            SELECT "kind", "state" FROM "Vote"
            WHERE "id" = ${op.voteId} AND "sessionId" = ${sid}
            FOR SHARE`
          if (vote.length === 0) refuse("floor.errorGone")
          if (vote[0].state !== "OPEN") refuse("floor.errorVoteClosed")
          // Attendance read inside the lock: the eligibility decision and the
          // insert are one unit.
          const status = (
            await tx.sessionAttendance.findUnique({
              where: { sessionId_portfolioId: { sessionId: sid, portfolioId: me } },
              select: { status: true },
            })
          )?.status ?? null
          const decision = decideBallot(vote[0].kind, status, op.choice)
          if (!decision.ok) {
            refuse(
              decision.reason === "not-present"
                ? "floor.errorNotPresent"
                : decision.reason === "no-abstain-procedural"
                  ? "floor.errorNoAbstainProcedural"
                  : "floor.errorNoAbstainVoting",
            )
          }
          await tx.voteBallot.create({
            data: { voteId: op.voteId, portfolioId: me, choice: op.choice, castById: viewer.userId, castByEmail: viewer.email },
          })
        })
        break
      }
    }
  } catch (err) {
    if (err instanceof FloorRefusal) return { success: false, error: err.message }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { success: false, error: t(op.op === "castBallot" ? "floor.errorAlreadyVoted" : "floor.errorAlreadyQueued") }
    }
    throw err
  }

  floorNudge(committeeId)
  return { success: true }
}
