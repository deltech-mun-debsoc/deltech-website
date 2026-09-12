// Who may listen on a channel, and who may publish to it.
//
// Supabase's model was "anyone holding the publishable key can subscribe to, and
// publish on, any channel". That was tolerable only because every payload was a
// nudge rather than data. Running the bus ourselves, the rules can be real:
// publishing to a quiz room is staff-only, so a bored participant can no longer
// push a fake leaderboard to the hall, and recruitment channels are staff-only
// in both directions.
//
// Pure, so scripts/check-realtime-bus.ts can pin every rule.

export type ChannelKind = "quiz" | "recruitment"

export interface ChannelRef {
  kind: ChannelKind
  /** Room code for quiz, cycle id for recruitment. */
  id: string
}

const QUIZ = /^quiz:([A-Z0-9]{4,12})$/
const RECRUITMENT = /^recruitment:([A-Za-z0-9_-]{1,40})$/

export function parseChannel(raw: string): ChannelRef | null {
  const quiz = QUIZ.exec(raw)
  if (quiz) return { kind: "quiz", id: quiz[1] }
  const recruitment = RECRUITMENT.exec(raw)
  if (recruitment) return { kind: "recruitment", id: recruitment[1] }
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

/** Listening: a quiz room is open to whoever has the code, as the join page is. */
export function canSubscribe(ref: ChannelRef, viewer: Viewer): boolean {
  return ref.kind === "quiz" ? true : viewer.authenticated
}

/**
 * Publishing a quiz event is staff-only, matching requireStaff() on the presenter
 * actions. Recruitment nudges carry no data, so any signed-in role may send one,
 * matching the coarse gate the proxy already applies to /recruitment.
 */
export function canPublish(ref: ChannelRef, viewer: Viewer): boolean {
  return ref.kind === "quiz" ? viewer.staff : viewer.authenticated
}
