// The committee floor: who holds the mic, and votes. Pure: no Prisma, no React,
// so scripts/check-committee-floor.ts can pin every rule.
//
// Attendance, speakers lists and motions are deliberately not here: chairs keep
// those on their own sheets. What the platform owns is what only it can do: who
// may be seen and heard on the floor, and a ballot that cannot be cast twice.
//
// Votes follow the UN General Assembly where a choice was needed: decided by a
// majority of those voting yes or no. Abstentions are not counted (rule 86), and
// a procedural vote admits none at all.

export type VoteKindName = "PROCEDURAL" | "SUBSTANTIVE"
export type VoteMajorityName = "SIMPLE" | "TWO_THIRDS"
export type BallotChoiceName = "YES" | "NO" | "ABSTAIN"

export const MAX_SUBJECT = 200

export type BallotRefusal = "no-abstain-procedural"

/** Whether this choice may be cast on this kind of vote. Every seated delegation votes. */
export function decideBallot(
  kind: VoteKindName,
  choice: BallotChoiceName,
): { ok: true } | { ok: false; reason: BallotRefusal } {
  if (choice === "ABSTAIN" && kind === "PROCEDURAL") return { ok: false, reason: "no-abstain-procedural" }
  return { ok: true }
}

/**
 * Whether a vote passes: a majority of those voting yes or no. Two thirds is
 * measured the same way. Nobody voting yes or no is a failure, not a tie.
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

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null
  // Same stripping as chat: no control or bidi characters in text the room reads.
  const t = raw.replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim()
  return t && t.length <= max ? t : null
}

export type DaisOp =
  | { op: "giveMic"; portfolioId: string }
  | { op: "takeMic" }
  | { op: "openVote"; subject: string; kind: VoteKindName; majority: VoteMajorityName }
  | { op: "closeVote"; voteId: string }

/** A dais action from a server action's arguments, or null. Nothing is defaulted. */
export function parseDaisOp(raw: unknown): DaisOp | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  switch (r.op) {
    case "giveMic": {
      const portfolioId = id(r.portfolioId)
      return portfolioId ? { op: "giveMic", portfolioId } : null
    }
    case "takeMic":
      return { op: "takeMic" }
    case "openVote": {
      const subject = text(r.subject, MAX_SUBJECT)
      const kind = r.kind === "PROCEDURAL" || r.kind === "SUBSTANTIVE" ? r.kind : null
      const majority = r.majority === "SIMPLE" || r.majority === "TWO_THIRDS" ? r.majority : null
      return subject && kind && majority ? { op: "openVote", subject, kind, majority } : null
    }
    case "closeVote": {
      const voteId = id(r.voteId)
      return voteId ? { op: "closeVote", voteId } : null
    }
    default:
      return null
  }
}

export type DelegateOp = { op: "castBallot"; voteId: string; choice: BallotChoiceName }

export function parseDelegateOp(raw: unknown): DelegateOp | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (r.op !== "castBallot") return null
  const voteId = id(r.voteId)
  const choice = r.choice === "YES" || r.choice === "NO" || r.choice === "ABSTAIN" ? r.choice : null
  return voteId && choice ? { op: "castBallot", voteId, choice } : null
}
