// The committee floor: speakers lists, motions and votes. Pure: no Prisma, no
// React, so scripts/check-committee-floor.ts can pin every rule.
//
// Procedure follows the UN General Assembly's rules where a choice was needed:
// decisions are by a majority of members "present and voting", meaning those
// casting a yes or a no. Abstentions are not counted (rule 86), and a
// procedural vote admits no abstentions at all.

import { isPresent, mayAbstain, type CommitteeAttendanceName } from "./roll-call"

export type SpeakerStateName = "QUEUED" | "SPEAKING" | "SPOKEN" | "REMOVED"
export type MotionKindName = "MODERATED_CAUCUS" | "UNMODERATED_CAUCUS" | "EXTEND" | "CLOSE_DEBATE" | "OTHER"
export type MotionStateName =
  | "PROPOSED"
  | "VOTING"
  | "PASSED"
  | "FAILED"
  | "WITHDRAWN"
  | "RULED_OUT"
  | "IN_PROGRESS"
  | "ENDED"
export type VoteKindName = "PROCEDURAL" | "SUBSTANTIVE"
export type VoteMajorityName = "SIMPLE" | "TWO_THIRDS"
export type BallotChoiceName = "YES" | "NO" | "ABSTAIN"

export const SPEAKING_SECONDS = { min: 15, max: 600 } as const
export const CAUCUS_SECONDS = { min: 60, max: 3600 } as const
export const MAX_TOPIC = 200
export const MAX_SUBJECT = 200

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

// A speaker's time and a caucus's time are the same kind of clock: an allotment,
// a start, pauses, an end. Derived on the server's timestamps only; a browser
// renders it with the skew correction in src/lib/session.ts.
export interface Clock {
  allottedSeconds: number
  startedAt: Date | null
  pausedAt: Date | null
  pausedMs: number
  endedAt: Date | null
}

export function elapsedClockMs(c: Clock, now: Date): number {
  if (!c.startedAt) return 0
  // A paused or ended clock stops at the moment it stopped, not at "now".
  const stop = c.endedAt ?? c.pausedAt ?? now
  return Math.max(0, stop.getTime() - c.startedAt.getTime() - c.pausedMs)
}

/** Negative once the time is up: the chair sees how far over a speaker is. */
export function remainingMs(c: Clock, now: Date): number {
  return c.allottedSeconds * 1000 - elapsedClockMs(c, now)
}

type ClockPatch = Partial<Pick<Clock, "startedAt" | "pausedAt" | "pausedMs" | "endedAt">>

export function pauseClock(c: Clock, now: Date): ClockPatch | null {
  if (!c.startedAt || c.pausedAt || c.endedAt) return null
  return { pausedAt: now }
}

export function resumeClock(c: Clock, now: Date): ClockPatch | null {
  if (!c.pausedAt || c.endedAt) return null
  return { pausedAt: null, pausedMs: c.pausedMs + Math.max(0, now.getTime() - c.pausedAt.getTime()) }
}

/** Ending folds any open pause into pausedMs, so elapsed time stays exact afterwards. */
export function endClock(c: Clock, now: Date): ClockPatch | null {
  if (!c.startedAt || c.endedAt) return null
  const pausedMs = c.pausedAt ? c.pausedMs + Math.max(0, now.getTime() - c.pausedAt.getTime()) : c.pausedMs
  return { pausedAt: null, pausedMs, endedAt: now }
}

// ---------------------------------------------------------------------------
// Speakers lists
// ---------------------------------------------------------------------------

/** The unique key that allows one live place per delegation per list. */
export function liveKey(sessionId: string, motionId: string | null, portfolioId: string): string {
  return `${sessionId}:${motionId ?? "gsl"}:${portfolioId}`
}

export interface QueuedEntry {
  id: string
  position: number
  state: SpeakerStateName
}

/** Who speaks next on a list: the lowest-positioned queued entry. */
export function nextInLine<T extends QueuedEntry>(entries: readonly T[]): T | null {
  let best: T | null = null
  for (const e of entries) {
    if (e.state !== "QUEUED") continue
    if (!best || e.position < best.position) best = e
  }
  return best
}

// ---------------------------------------------------------------------------
// Motions
// ---------------------------------------------------------------------------

export type MotionAction =
  | "withdraw"
  | "ruleOut"
  | "putToVote"
  | "pass"
  | "fail"
  | "start"
  | "end"

const CAUCUS: ReadonlySet<MotionKindName> = new Set(["MODERATED_CAUCUS", "UNMODERATED_CAUCUS"])

export function isCaucus(kind: MotionKindName): boolean {
  return CAUCUS.has(kind)
}

/**
 * The state a motion moves to, or null if the action does not apply. `pass` and
 * `fail` are only ever applied by closing its vote, never directly by a person.
 */
export function decideMotion(
  motion: { state: MotionStateName; kind: MotionKindName },
  action: MotionAction,
): MotionStateName | null {
  switch (action) {
    case "withdraw":
      return motion.state === "PROPOSED" ? "WITHDRAWN" : null
    case "ruleOut":
      return motion.state === "PROPOSED" ? "RULED_OUT" : null
    case "putToVote":
      return motion.state === "PROPOSED" ? "VOTING" : null
    case "pass":
      return motion.state === "VOTING" ? "PASSED" : null
    case "fail":
      return motion.state === "VOTING" ? "FAILED" : null
    case "start":
      // Only a caucus has anything to run; an extension or closure is applied by
      // the chair and recorded by the vote itself.
      return motion.state === "PASSED" && isCaucus(motion.kind) ? "IN_PROGRESS" : null
    case "end":
      return motion.state === "IN_PROGRESS" ? "ENDED" : null
  }
}

export interface MotionDraft {
  kind: MotionKindName
  topic: string | null
  totalSeconds: number | null
  speakingSeconds: number | null
}

const KINDS: ReadonlySet<string> = new Set(["MODERATED_CAUCUS", "UNMODERATED_CAUCUS", "EXTEND", "CLOSE_DEBATE", "OTHER"])

function intIn(raw: unknown, range: { min: number; max: number }): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= range.min && raw <= range.max ? raw : null
}

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null
  // Same stripping as chat: no control or bidi characters in names the room reads.
  const t = raw.replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim()
  return t && t.length <= max ? t : null
}

/**
 * A motion as a delegate or the dais proposes it. Each kind carries exactly the
 * fields it needs; anything missing or out of range refuses the whole motion
 * rather than defaulting, because a caucus nobody asked for is worse than none.
 */
export function parseMotionDraft(raw: unknown): MotionDraft | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.kind !== "string" || !KINDS.has(r.kind)) return null
  const kind = r.kind as MotionKindName
  const none = { topic: null, totalSeconds: null, speakingSeconds: null }

  if (kind === "MODERATED_CAUCUS") {
    const topic = text(r.topic, MAX_TOPIC)
    const totalSeconds = intIn(r.totalSeconds, CAUCUS_SECONDS)
    const speakingSeconds = intIn(r.speakingSeconds, SPEAKING_SECONDS)
    if (!topic || !totalSeconds || !speakingSeconds || speakingSeconds > totalSeconds) return null
    return { kind, topic, totalSeconds, speakingSeconds }
  }
  if (kind === "UNMODERATED_CAUCUS" || kind === "EXTEND") {
    const totalSeconds = intIn(r.totalSeconds, CAUCUS_SECONDS)
    return totalSeconds ? { kind, ...none, totalSeconds } : null
  }
  if (kind === "OTHER") {
    const topic = text(r.topic, MAX_TOPIC)
    return topic ? { kind, ...none, topic } : null
  }
  return { kind, ...none }
}

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------

export type BallotRefusal = "not-present" | "no-abstain-procedural" | "no-abstain-voting"

/**
 * Whether a delegation in this attendance state may cast this choice. Only a
 * delegation present in the room votes at all. Procedural votes admit no
 * abstention; on a substantive vote, "present and voting" has given it up.
 */
export function decideBallot(
  kind: VoteKindName,
  attendance: CommitteeAttendanceName | null,
  choice: BallotChoiceName,
): { ok: true } | { ok: false; reason: BallotRefusal } {
  if (!attendance || !isPresent(attendance)) return { ok: false, reason: "not-present" }
  if (choice !== "ABSTAIN") return { ok: true }
  if (kind === "PROCEDURAL") return { ok: false, reason: "no-abstain-procedural" }
  if (!mayAbstain(attendance)) return { ok: false, reason: "no-abstain-voting" }
  return { ok: true }
}

/**
 * Whether a vote passes: a majority of those present and voting, meaning yes
 * plus no. Two thirds is measured the same way. Nobody voting yes or no is a
 * failure, not a tie.
 */
export function votePasses(majority: VoteMajorityName, yes: number, no: number): boolean {
  const voting = yes + no
  if (voting === 0) return false
  if (majority === "SIMPLE") return yes > no
  return yes * 3 >= voting * 2
}

export interface Tally {
  yes: number
  no: number
  abstain: number
}

export function tallyBallots(choices: readonly BallotChoiceName[]): Tally {
  const t = { yes: 0, no: 0, abstain: 0 }
  for (const c of choices) {
    if (c === "YES") t.yes++
    else if (c === "NO") t.no++
    else t.abstain++
  }
  return t
}

// ---------------------------------------------------------------------------
// What the room may do, parsed at the door
// ---------------------------------------------------------------------------

const ID = /^[A-Za-z0-9_-]{1,40}$/
const id = (raw: unknown): string | null => (typeof raw === "string" && ID.test(raw) ? raw : null)
const optionalId = (raw: unknown): string | null | undefined =>
  raw === null || raw === undefined ? null : (id(raw) ?? undefined)

export type DaisOp =
  | { op: "addSpeaker"; portfolioId: string; motionId: string | null }
  | { op: "removeSpeaker"; entryId: string }
  | { op: "nextSpeaker"; motionId: string | null }
  | { op: "pauseSpeaker" | "resumeSpeaker" | "endSpeaker"; entryId: string }
  | { op: "setGslTime"; seconds: number }
  | { op: "raiseMotion"; draft: MotionDraft }
  | { op: "ruleOut" | "putToVote" | "startCaucus" | "endCaucus" | "pauseCaucus" | "resumeCaucus"; motionId: string }
  | { op: "openVote"; subject: string; majority: VoteMajorityName }
  | { op: "closeVote"; voteId: string }

/** A dais action from a server action's arguments, or null. Nothing is defaulted. */
export function parseDaisOp(raw: unknown): DaisOp | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  switch (r.op) {
    case "addSpeaker": {
      const portfolioId = id(r.portfolioId)
      const motionId = optionalId(r.motionId)
      return portfolioId && motionId !== undefined ? { op: "addSpeaker", portfolioId, motionId } : null
    }
    case "nextSpeaker": {
      const motionId = optionalId(r.motionId)
      return motionId !== undefined ? { op: "nextSpeaker", motionId } : null
    }
    case "removeSpeaker":
    case "pauseSpeaker":
    case "resumeSpeaker":
    case "endSpeaker": {
      const entryId = id(r.entryId)
      return entryId ? { op: r.op, entryId } : null
    }
    case "setGslTime": {
      const seconds = intIn(r.seconds, SPEAKING_SECONDS)
      return seconds ? { op: "setGslTime", seconds } : null
    }
    case "raiseMotion": {
      const draft = parseMotionDraft(r.draft)
      return draft ? { op: "raiseMotion", draft } : null
    }
    case "ruleOut":
    case "putToVote":
    case "startCaucus":
    case "endCaucus":
    case "pauseCaucus":
    case "resumeCaucus": {
      const motionId = id(r.motionId)
      return motionId ? { op: r.op, motionId } : null
    }
    case "openVote": {
      const subject = text(r.subject, MAX_SUBJECT)
      const majority = r.majority === "SIMPLE" || r.majority === "TWO_THIRDS" ? r.majority : null
      return subject && majority ? { op: "openVote", subject, majority } : null
    }
    case "closeVote": {
      const voteId = id(r.voteId)
      return voteId ? { op: "closeVote", voteId } : null
    }
    default:
      return null
  }
}

export type DelegateOp =
  | { op: "requestToSpeak" | "withdrawRequest"; motionId: string | null }
  | { op: "proposeMotion"; draft: MotionDraft }
  | { op: "withdrawMotion"; motionId: string }
  | { op: "castBallot"; voteId: string; choice: BallotChoiceName }

export function parseDelegateOp(raw: unknown): DelegateOp | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  switch (r.op) {
    case "requestToSpeak":
    case "withdrawRequest": {
      const motionId = optionalId(r.motionId)
      return motionId !== undefined ? { op: r.op, motionId } : null
    }
    case "proposeMotion": {
      const draft = parseMotionDraft(r.draft)
      return draft ? { op: "proposeMotion", draft } : null
    }
    case "withdrawMotion": {
      const motionId = id(r.motionId)
      return motionId ? { op: "withdrawMotion", motionId } : null
    }
    case "castBallot": {
      const voteId = id(r.voteId)
      const choice = r.choice === "YES" || r.choice === "NO" || r.choice === "ABSTAIN" ? r.choice : null
      return voteId && choice ? { op: "castBallot", voteId, choice } : null
    }
    default:
      return null
  }
}
