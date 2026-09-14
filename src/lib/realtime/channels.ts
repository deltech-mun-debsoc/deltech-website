// Who may listen on a channel, and who may publish to it.
//
// Every payload is a nudge rather than data, and the rules are still real:
// publishing to a quiz room is staff-only, so a bored participant can no longer
// push a fake leaderboard to the hall, and recruitment channels are staff-only
// in both directions.
//
// Pure, so scripts/check-realtime-bus.ts can pin every rule.

export type ChannelKind = "quiz" | "recruitment" | "allotment"

export interface ChannelRef {
  kind: ChannelKind
  /** Room code for quiz, cycle id for recruitment, event id for allotment. */
  id: string
}

const QUIZ = /^quiz:([A-Z0-9]{4,12})$/
const RECRUITMENT = /^recruitment:([A-Za-z0-9_-]{1,40})$/
const ALLOTMENT = /^allotment:([A-Za-z0-9_-]{1,40})$/

export function parseChannel(raw: string): ChannelRef | null {
  const quiz = QUIZ.exec(raw)
  if (quiz) return { kind: "quiz", id: quiz[1] }
  const recruitment = RECRUITMENT.exec(raw)
  if (recruitment) return { kind: "recruitment", id: recruitment[1] }
  const allotment = ALLOTMENT.exec(raw)
  if (allotment) return { kind: "allotment", id: allotment[1] }
  return null
}

export function channelName(ref: ChannelRef): string {
  return `${ref.kind}:${ref.id}`
}

export interface Viewer {
  /** ADMIN or MAINTAINER: the same bar requireStaff() sets. */
  staff: boolean
  /** Any signed-in role. Recruitment access itself is per-cycle and checked server-side. */
  authenticated: boolean
}

/**
 * Listening: a quiz room is open to whoever has the code, as the join page is.
 * The allotment board is staff-only, matching requireStaff() on the page: which
 * seats are moving, and when, is not something a signed-in delegate should watch.
 */
export function canSubscribe(ref: ChannelRef, viewer: Viewer): boolean {
  if (ref.kind === "quiz") return true
  if (ref.kind === "allotment") return viewer.staff
  return viewer.authenticated
}

/**
 * Publishing a quiz event is staff-only, matching requireStaff() on the presenter
 * actions. Recruitment nudges carry no data, so any signed-in role may send one,
 * matching the coarse gate the proxy already applies to /recruitment.
 */
export function canPublish(ref: ChannelRef, viewer: Viewer): boolean {
  if (ref.kind === "quiz" || ref.kind === "allotment") return viewer.staff
  return viewer.authenticated
}
