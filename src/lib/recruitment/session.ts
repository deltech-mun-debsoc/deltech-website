// Server-authoritative session timing and lifecycle decisions. Pure: no Prisma,
// no React, so scripts/check-recruitment-session.ts can exercise every race and
// clock-skew case without a database.
//
// The rule this file exists to enforce: the browser never decides anything about
// a session. It renders what the server's timestamps imply. Every lifecycle
// change is expressed as a decision ("apply" / "noop" / "conflict") that the
// caller then executes as a conditional UPDATE on { id, state, version }.

export type SessionStateName = "NOT_STARTED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ABORTED"

export interface SessionSnapshot {
  id: string
  state: SessionStateName
  version: number
  controllerId: string | null
  controlExpiresAt: Date | null
  startedAt: Date | null
  pausedAt: Date | null
  endedAt: Date | null
  pausedMs: number
  lastActivityAt: Date | null
}

// How long a maintainer's claim on a session survives without activity. After
// this, another maintainer may take control, which is how we recover a session
// whose owner closed their laptop mid-GD.
export const CONTROL_LEASE_MS = 2 * 60 * 1000

// A live session with no activity for this long is reported as stale on the admin
// monitor. It is a warning, not an automatic state change: silently ending
// someone's GD would be worse than showing it as suspect.
export const STALE_AFTER_MS = 15 * 60 * 1000

// ---------------------------------------------------------------------------
// Elapsed time
// ---------------------------------------------------------------------------

// Elapsed = (end ?? now) - start - accumulated pause, with the currently-open
// pause window included when the session sits PAUSED.
//
// `serverNow` must come from the server. Passing a browser Date here would
// reintroduce exactly the clock-manipulation bug this design avoids; client code
// gets `serverNow` in the payload and corrects for skew (see skewCorrectedNow).
export function elapsedMs(s: SessionSnapshot, serverNow: Date): number {
  if (!s.startedAt) return 0

  const end = s.endedAt ?? serverNow
  const gross = end.getTime() - s.startedAt.getTime()

  // While paused, the open pause window counts against elapsed time too.
  const openPause =
    s.state === "PAUSED" && s.pausedAt ? Math.max(0, end.getTime() - s.pausedAt.getTime()) : 0

  return Math.max(0, gross - s.pausedMs - openPause)
}

// The pause milliseconds to persist when resuming or ending a paused session.
export function accumulatedPauseMs(s: SessionSnapshot, serverNow: Date): number {
  if (s.state !== "PAUSED" || !s.pausedAt) return s.pausedMs
  return s.pausedMs + Math.max(0, serverNow.getTime() - s.pausedAt.getTime())
}

// Clients call this once per payload: the offset between their clock and the
// server's, so a locally-ticking timer stays anchored to server time even if the
// device clock is wrong or deliberately changed.
export function clockSkewMs(serverNow: Date, clientNow: Date): number {
  return clientNow.getTime() - serverNow.getTime()
}

export function skewCorrectedNow(clientNow: Date, skew: number): Date {
  return new Date(clientNow.getTime() - skew)
}

// A temporary client-side view used while a reversible lifecycle request is in
// flight. It deliberately mirrors only start / pause / resume. Completing or
// aborting a session has wider effects (draft submission, candidate movement,
// locks and audit rows), so those actions must remain server-confirmed.
//
// The timestamps here make the control feel immediate; the returned server row
// always replaces them. Bumping the view version also stops an older RSC refresh
// from visually undoing the click before that response arrives.
export interface OptimisticSessionView {
  state: SessionStateName
  version: number
  controllerId: string | null
  startedAt: string | null
  pausedAt: string | null
  endedAt: string | null
  pausedMs: number
  lastActivityAt: string | null
  serverNow: string
}

export type OptimisticSessionAction = "start" | "pause" | "resume"

export function optimisticSessionTransition<T extends OptimisticSessionView>(
  session: T,
  action: OptimisticSessionAction,
  actorId: string,
  clientNow = new Date(),
): T {
  const now = clientNow.toISOString()
  const next = {
    ...session,
    version: session.version + 1,
    lastActivityAt: now,
    serverNow: now,
  }

  if (action === "start") {
    return {
      ...next,
      state: "ACTIVE",
      controllerId: actorId,
      startedAt: session.startedAt ?? now,
      pausedAt: null,
      endedAt: null,
    }
  }

  if (action === "pause") {
    return { ...next, state: "PAUSED", pausedAt: now }
  }

  const openPauseMs = session.pausedAt
    ? Math.max(0, clientNow.getTime() - new Date(session.pausedAt).getTime())
    : 0
  return {
    ...next,
    state: "ACTIVE",
    pausedAt: null,
    pausedMs: session.pausedMs + openPauseMs,
  }
}

export function isStale(s: SessionSnapshot, serverNow: Date): boolean {
  if (s.state !== "ACTIVE" && s.state !== "PAUSED") return false
  const last = s.lastActivityAt ?? s.startedAt
  if (!last) return false
  return serverNow.getTime() - last.getTime() > STALE_AFTER_MS
}

// ---------------------------------------------------------------------------
// Lifecycle decisions
// ---------------------------------------------------------------------------

// "apply"   : perform the conditional update
// "noop"    : already in the requested state; report success (idempotent retry)
// "conflict": someone else's newer state wins; return it and let the UI reconcile
export type SessionDecision = "apply" | "noop" | "conflict"

export interface DecisionInput {
  actorId: string
  // Version the client believed it was acting on. Omit to skip the staleness
  // check (server-internal callers that just re-read the row).
  expectedVersion?: number
  serverNow: Date
}

// Shared preconditions: a stale client version always loses, so a queued click
// from a minute ago can never override newer state.
function versionConflict(s: SessionSnapshot, input: DecisionInput): boolean {
  return input.expectedVersion !== undefined && input.expectedVersion !== s.version
}

// controllerId records WHO IS DRIVING. It no longer decides who MAY.
//
// It used to be a lease: whoever started the session held it, and every other
// maintainer was refused pause/resume/finish until the lease lapsed or they
// pressed "Take control". One person marks while the panel deliberates off the
// site, so the takeover button was ceremony -- and the lease it guarded could
// lock out the very person trying to finish, with the only way through being a
// button they had no reason to understand.
//
// The column is still written on every action, so "who ran this session" is still
// answerable, and every audit row already names its actor. What is gone is the
// refusal. Concurrent drivers are still safe: `expectedVersion` makes a stale
// tab's click lose rather than overwrite.

export function decideStart(s: SessionSnapshot, input: DecisionInput): SessionDecision {
  if (s.state === "ACTIVE") return "noop" // double-click, retry, or second tab
  if (s.state === "PAUSED") return "conflict" // must resume, not start
  if (s.state === "COMPLETED" || s.state === "ABORTED") return "conflict" // needs a reopen
  if (versionConflict(s, input)) return "conflict"
  return "apply"
}

export function decidePause(s: SessionSnapshot, input: DecisionInput): SessionDecision {
  if (s.state === "PAUSED") return "noop"
  if (s.state !== "ACTIVE") return "conflict"
  if (versionConflict(s, input)) return "conflict"
  return "apply"
}

export function decideResume(s: SessionSnapshot, input: DecisionInput): SessionDecision {
  if (s.state === "ACTIVE") return "noop"
  if (s.state !== "PAUSED") return "conflict"
  if (versionConflict(s, input)) return "conflict"
  return "apply"
}

export function decideFinish(s: SessionSnapshot, input: DecisionInput): SessionDecision {
  if (s.state === "COMPLETED") return "noop" // ending twice is not an error
  if (s.state === "ABORTED") return "conflict"
  if (s.state === "NOT_STARTED") return "conflict" // nothing to finish
  if (versionConflict(s, input)) return "conflict"
  return "apply"
}

export function decideAbort(s: SessionSnapshot, input: DecisionInput): SessionDecision {
  if (s.state === "ABORTED") return "noop"
  if (s.state === "COMPLETED") return "conflict"
  if (versionConflict(s, input)) return "conflict"
  return "apply"
}


// A reopen never mutates the completed row: it creates the next attempt. This
// keeps the original timings, evaluations and audit trail intact.
export function decideReopen(s: SessionSnapshot): SessionDecision {
  if (s.state === "COMPLETED" || s.state === "ABORTED") return "apply"
  // Still live: nothing to reopen.
  return "noop"
}

export function nextControlExpiry(serverNow: Date): Date {
  return new Date(serverNow.getTime() + CONTROL_LEASE_MS)
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

// What the operator sees at a glance. Distinguishes stale from active, which the
// admin monitor needs and a plain state column cannot express.
export type SessionDisplayState = SessionStateName | "STALE"

export function displayState(s: SessionSnapshot, serverNow: Date): SessionDisplayState {
  return isStale(s, serverNow) ? "STALE" : s.state
}
