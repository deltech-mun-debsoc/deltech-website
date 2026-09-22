// Committee chat rules. Pure: no Prisma, no React, so
// scripts/check-committee-chat.ts can pin who sees what without a database.
//
// The one rule everything here serves: a delegation sees the floor, its own
// conversations, and nothing else. The dais sees everything in its committee.
// Visibility is decided on the server for every read. The realtime channel only
// ever carries a bare nudge, so a delegate's browser never receives a message it
// may not see, even one it would not render.

export type ChatScope = "FLOOR" | "DM" | "EB"
export type ChatState = "SENT" | "HELD" | "BLOCKED"

export type ChatViewer =
  | { kind: "dais"; userId: string; email: string }
  | { kind: "delegate"; userId: string; email: string; portfolioId: string; portfolioName: string }

export const MAX_BODY = 1000

// How far behind its cursor a client re-reads. Ids are allocated at insert but
// become visible at commit, so a lower id can appear after a higher one has been
// read. At conference volume the gap is a handful of ids; 50 is generous, and the
// client drops duplicates by id.
export const CURSOR_OVERLAP = 50

// One page. A client that is further behind than this pages forward on the
// next fetch rather than pulling a whole day of chat in one response.
export const PAGE_SIZE = 100

// Control characters other than newline and tab are stripped: they render as
// nothing or garbage, and a zero-width run is a cheap way to post a message that
// looks empty. Bidi overrides are removed so a message cannot visually reorder
// its own text or the name beside it.
const STRIP = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g

/** The stored form of a message, or null if nothing sendable remains. */
export function normalizeBody(raw: string): string | null {
  const body = raw
    .replace(/\r\n?/g, "\n")
    .replace(STRIP, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (!body) return null
  if (body.length > MAX_BODY) return null
  return body
}

export interface Draft {
  scope: ChatScope
  toPortfolioId: string | null
  body: string
}

export interface SendContext {
  /** Allotted seats in this committee: the only valid DM recipients. */
  seatIds: ReadonlySet<string>
  holdDirectMessages: boolean
}

export type SendRefusal = "empty" | "too-long" | "bad-recipient" | "not-allowed"

export type SendDecision =
  | { ok: true; state: ChatState; body: string; toPortfolioId: string | null }
  | { ok: false; reason: SendRefusal }

export function decideSend(viewer: ChatViewer, draft: Draft, ctx: SendContext): SendDecision {
  if (draft.body.length > MAX_BODY * 4) return { ok: false, reason: "too-long" }
  const body = normalizeBody(draft.body)
  if (body === null) {
    return { ok: false, reason: draft.body.trim().length > MAX_BODY ? "too-long" : "empty" }
  }

  if (viewer.kind === "dais") {
    // The dais speaks to the floor, or answers one delegation in its EB thread.
    // It has no need for DMs: every delegate conversation is already visible to it.
    if (draft.scope === "FLOOR") {
      return draft.toPortfolioId === null
        ? { ok: true, state: "SENT", body, toPortfolioId: null }
        : { ok: false, reason: "bad-recipient" }
    }
    if (draft.scope === "EB") {
      return draft.toPortfolioId && ctx.seatIds.has(draft.toPortfolioId)
        ? { ok: true, state: "SENT", body, toPortfolioId: draft.toPortfolioId }
        : { ok: false, reason: "bad-recipient" }
    }
    return { ok: false, reason: "not-allowed" }
  }

  if (draft.scope === "FLOOR" || draft.scope === "EB") {
    // A delegate's EB message goes to the dais as a whole, never to one seat.
    return draft.toPortfolioId === null
      ? { ok: true, state: "SENT", body, toPortfolioId: null }
      : { ok: false, reason: "bad-recipient" }
  }

  // DM: another allotted seat in this committee, never self.
  const to = draft.toPortfolioId
  if (!to || to === viewer.portfolioId || !ctx.seatIds.has(to)) {
    return { ok: false, reason: "bad-recipient" }
  }
  return { ok: true, state: ctx.holdDirectMessages ? "HELD" : "SENT", body, toPortfolioId: to }
}

export interface MessageFacts {
  scope: ChatScope
  state: ChatState
  fromPortfolioId: string | null
  toPortfolioId: string | null
}

/**
 * Whether this viewer may see this message. `visibleWhere` below is the same
 * rule written for the database; the check script proves the two agree.
 */
export function canSee(viewer: ChatViewer, m: MessageFacts): boolean {
  if (viewer.kind === "dais") return true
  const me = viewer.portfolioId
  const mine = m.fromPortfolioId === me
  // Held: only its sender, while it waits. Blocked: nobody but the dais, not
  // even its sender, so a removed message cannot be screenshotted as "live".
  if (m.state === "HELD") return mine
  if (m.state === "BLOCKED") return false
  if (m.scope === "FLOOR") return true
  return mine || m.toPortfolioId === me
}

/** The Prisma `where` for `canSee`, scoped to one committee. */
export function visibleWhere(viewer: ChatViewer, committeeId: string) {
  if (viewer.kind === "dais") return { committeeId }
  const me = viewer.portfolioId
  return {
    committeeId,
    OR: [
      { state: "SENT" as const, scope: "FLOOR" as const },
      {
        state: "SENT" as const,
        scope: { in: ["DM" as const, "EB" as const] },
        OR: [{ fromPortfolioId: me }, { toPortfolioId: me }],
      },
      { state: "HELD" as const, fromPortfolioId: me },
    ],
  }
}

export type ModerationAction = "approve" | "block" | "restore"

/**
 * The state a moderation action moves a message to, or null if it does not
 * apply. Approving is only for held messages; restoring un-blocks a message the
 * dais removed by mistake. Nothing ever returns to HELD.
 */
export function decideModeration(state: ChatState, action: ModerationAction): ChatState | null {
  if (action === "approve") return state === "HELD" ? "SENT" : null
  if (action === "block") return state === "BLOCKED" ? null : "BLOCKED"
  return state === "BLOCKED" ? "SENT" : null
}

export interface StoredMessage extends MessageFacts {
  id: number
  fromLabel: string
  toLabel: string | null
  authorEmail: string
  body: string
  moderatedAt: Date | null
  createdAt: Date
}

export interface MessageView {
  id: number
  scope: ChatScope
  state: ChatState
  fromPortfolioId: string | null
  toPortfolioId: string | null
  fromLabel: string
  toLabel: string | null
  body: string
  createdAt: string
  mine: boolean
  /** Dais only: which account typed it. Absent for delegates. */
  authorEmail?: string
}

/**
 * What leaves the server. The author's account is a safeguarding detail for the
 * dais, so it is built into the view only for the dais rather than stripped
 * afterwards: a field that is never added cannot be forgotten.
 */
export function present(viewer: ChatViewer, m: StoredMessage): MessageView {
  const view: MessageView = {
    id: m.id,
    scope: m.scope,
    state: m.state,
    fromPortfolioId: m.fromPortfolioId,
    toPortfolioId: m.toPortfolioId,
    fromLabel: m.fromLabel,
    toLabel: m.toLabel,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    mine:
      viewer.kind === "delegate"
        ? m.fromPortfolioId === viewer.portfolioId
        : m.fromPortfolioId === null,
  }
  if (viewer.kind === "dais") view.authorEmail = m.authorEmail
  return view
}

/** The id to read after, given the newest id a client has already seen. */
export function readAfter(cursor: number | null): number {
  if (cursor === null || !Number.isFinite(cursor) || cursor < 0) return 0
  return Math.max(0, Math.floor(cursor) - CURSOR_OVERLAP)
}

// Moderation changes old messages, far behind the id cursor, so they travel on a
// second cursor: the moderation time. Overlap for the same reason as ids: the
// timestamp is taken before the row commits.
export const MODERATION_OVERLAP_MS = 30_000

/**
 * Whether a message is addressed to this viewer at all, whatever its state. A
 * moderation change to such a message is this viewer's business: it either
 * becomes visible (approved, restored) or must disappear (blocked).
 */
export function addressedTo(viewer: ChatViewer, m: MessageFacts): boolean {
  if (viewer.kind === "dais") return true
  const me = viewer.portfolioId
  return m.scope === "FLOOR" || m.fromPortfolioId === me || m.toPortfolioId === me
}

/** The Prisma `where` for moderation changes this viewer must hear about. */
export function changedWhere(viewer: ChatViewer, committeeId: string, since: Date) {
  const base = { committeeId, moderatedAt: { gt: since } }
  if (viewer.kind === "dais") return base
  const me = viewer.portfolioId
  return {
    ...base,
    OR: [{ scope: "FLOOR" as const }, { fromPortfolioId: me }, { toPortfolioId: me }],
  }
}

export function moderationSince(cursor: string | null): Date {
  const t = cursor ? Date.parse(cursor) : NaN
  return Number.isFinite(t) ? new Date(t - MODERATION_OVERLAP_MS) : new Date(0)
}

/**
 * Merge a fetch into what a client already holds. `page` carries new and
 * re-surfaced messages in their current state; `removed` names ids moderation
 * has taken away from this viewer. Idempotent, so an overlapping refetch is harmless.
 */
export function mergeMessages(
  held: readonly MessageView[],
  page: readonly MessageView[],
  removed: readonly number[] = [],
): MessageView[] {
  const byId = new Map<number, MessageView>()
  for (const m of held) byId.set(m.id, m)
  for (const m of page) byId.set(m.id, m)
  for (const id of removed) byId.delete(id)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

const ID = /^[A-Za-z0-9_-]{1,40}$/

/** A committee or portfolio id as the database mints them, or null. */
export function parseId(raw: unknown): string | null {
  return typeof raw === "string" && ID.test(raw) ? raw : null
}

/**
 * A draft from a server action, which is a public POST endpoint whatever the
 * form looked like: anything not exactly the expected shape is refused here,
 * before a database is touched.
 */
export function parseDraft(raw: unknown): Draft | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (r.scope !== "FLOOR" && r.scope !== "DM" && r.scope !== "EB") return null
  if (typeof r.body !== "string" || r.body.length > MAX_BODY * 4) return null
  let toPortfolioId: string | null = null
  if (r.toPortfolioId !== null && r.toPortfolioId !== undefined) {
    toPortfolioId = parseId(r.toPortfolioId)
    if (!toPortfolioId) return null
  }
  return { scope: r.scope, toPortfolioId, body: r.body }
}

export function parseModerationAction(raw: unknown): ModerationAction | null {
  return raw === "approve" || raw === "block" || raw === "restore" ? raw : null
}
