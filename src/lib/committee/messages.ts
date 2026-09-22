import { prisma } from "@/lib/prisma"
import { bus } from "@/lib/realtime/bus"
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit"
import { audit } from "@/lib/audit"
import { t } from "@/content/strings"
import {
  PAGE_SIZE,
  canSee,
  changedWhere,
  decideModeration,
  decideSend,
  moderationSince,
  present,
  readAfter,
  visibleWhere,
  type ChatViewer,
  type Draft,
  type MessageView,
  type ModerationAction,
  type SendRefusal,
  type StoredMessage,
} from "./chat"

// Server side of committee chat. Callers authorise first (a delegate route or a
// requireStaff admin action), resolve a ChatViewer, and pass it in; nothing here
// trusts an id or a role from the client.

const SELECT = {
  id: true,
  scope: true,
  state: true,
  fromPortfolioId: true,
  toPortfolioId: true,
  fromLabel: true,
  toLabel: true,
  authorEmail: true,
  body: true,
  moderatedAt: true,
  createdAt: true,
} as const

/** Tell every open screen on a committee that something changed. Never a body. */
export function nudge(committeeId: string): void {
  bus.publish(`committee:${committeeId}`, "chat", null)
}

/** Allotted seats in a committee: the only valid DM recipients, by id and name. */
async function seats(committeeId: string): Promise<Map<string, string>> {
  const rows = await prisma.portfolio.findMany({
    where: { committeeId, allotment: { isNot: null } },
    select: { id: true, name: true },
  })
  return new Map(rows.map((r) => [r.id, r.name]))
}

const REFUSAL: Record<SendRefusal, string> = {
  empty: t("committeeChat.errorEmpty"),
  "too-long": t("committeeChat.errorTooLong"),
  "bad-recipient": t("committeeChat.errorRecipient"),
  "not-allowed": t("committeeChat.errorNotAllowed"),
}

export type SendResult = { success: true; message: MessageView } | { success: false; error: string }

export async function sendCommitteeMessage(
  viewer: ChatViewer,
  committeeId: string,
  draft: Draft,
): Promise<SendResult> {
  const limit = await rateLimit(RATE_LIMITS.committeeMessage, viewer.userId)
  if (!limit.ok) return { success: false, error: t("committeeChat.errorRateLimited", { s: limit.retryAfter }) }

  const committee = await prisma.committee.findUnique({
    where: { id: committeeId },
    select: { holdDirectMessages: true },
  })
  if (!committee) return { success: false, error: REFUSAL["not-allowed"] }

  const seatNames = await seats(committeeId)
  const decision = decideSend(viewer, draft, {
    seatIds: new Set(seatNames.keys()),
    holdDirectMessages: committee.holdDirectMessages,
  })
  if (!decision.ok) return { success: false, error: REFUSAL[decision.reason] }

  const dais = t("committeeChat.daisLabel")
  const fromLabel = viewer.kind === "delegate" ? viewer.portfolioName : dais
  const toLabel =
    draft.scope === "FLOOR"
      ? null
      : decision.toPortfolioId
        ? (seatNames.get(decision.toPortfolioId) ?? null)
        : dais

  const row = await prisma.committeeMessage.create({
    data: {
      committeeId,
      scope: draft.scope,
      state: decision.state,
      fromPortfolioId: viewer.kind === "delegate" ? viewer.portfolioId : null,
      toPortfolioId: decision.toPortfolioId,
      fromLabel,
      toLabel,
      authorId: viewer.userId,
      authorEmail: viewer.email,
      body: decision.body,
    },
    select: SELECT,
  })
  nudge(committeeId)
  return { success: true, message: present(viewer, row as StoredMessage) }
}

export interface MessagesPage {
  messages: MessageView[]
  /** Ids moderation has taken away from this viewer since `mod`. */
  removed: number[]
  /** Newest id this response covers; send back as `since`. */
  cursor: number
  /** Server time this response was read at; send back as `mod`. */
  modCursor: string
  /** True when a full page came back and the client should fetch again at once. */
  more: boolean
}

/**
 * A viewer's messages after `since`, plus moderation changes after `mod`. With
 * no `since`, the most recent page, which is what a freshly opened screen needs.
 */
export async function readCommitteeMessages(
  viewer: ChatViewer,
  committeeId: string,
  since: number | null,
  mod: string | null,
): Promise<MessagesPage> {
  // Taken before reading, so anything moderated during this read is caught by
  // the next one rather than falling between the two.
  const readAt = new Date()
  const where = visibleWhere(viewer, committeeId)

  const rows =
    since === null
      ? (
          await prisma.committeeMessage.findMany({ where, orderBy: { id: "desc" }, take: PAGE_SIZE, select: SELECT })
        ).reverse()
      : await prisma.committeeMessage.findMany({
          where: { ...where, id: { gt: readAfter(since) } },
          orderBy: { id: "asc" },
          take: PAGE_SIZE,
          select: SELECT,
        })

  const messages = rows.map((r) => present(viewer, r as StoredMessage))
  const removed: number[] = []

  // A fresh screen has no stale copies to correct.
  if (since !== null) {
    const changed = await prisma.committeeMessage.findMany({
      where: changedWhere(viewer, committeeId, moderationSince(mod)),
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      select: SELECT,
    })
    const inPage = new Set(messages.map((m) => m.id))
    for (const r of changed) {
      if (canSee(viewer, r)) {
        if (!inPage.has(r.id)) messages.push(present(viewer, r as StoredMessage))
      } else {
        removed.push(r.id)
      }
    }
    messages.sort((a, b) => a.id - b.id)
  }

  const newest = rows.length ? rows[rows.length - 1].id : 0
  return {
    messages,
    removed,
    cursor: Math.max(since ?? 0, newest),
    modCursor: readAt.toISOString(),
    more: since !== null && rows.length === PAGE_SIZE,
  }
}

export async function moderateCommitteeMessage(
  viewer: ChatViewer,
  committeeId: string,
  messageId: number,
  action: ModerationAction,
): Promise<{ success: boolean; error?: string }> {
  if (viewer.kind !== "dais") return { success: false, error: REFUSAL["not-allowed"] }

  const row = await prisma.committeeMessage.findFirst({
    where: { id: messageId, committeeId },
    select: { state: true, fromLabel: true },
  })
  if (!row) return { success: false, error: t("committeeChat.errorGone") }

  const next = decideModeration(row.state, action)
  if (!next) return { success: true } // already in the requested state: idempotent

  // Conditional on the state we read, so two dais members acting at once cannot
  // have the second silently undo the first.
  const result = await prisma.committeeMessage.updateMany({
    where: { id: messageId, committeeId, state: row.state },
    data: { state: next, moderatedById: viewer.email, moderatedAt: new Date() },
  })
  if (result.count === 0) return { success: false, error: t("committeeChat.errorChanged") }

  await audit(viewer.email, `committee_message_${action}`, "CommitteeMessage", String(messageId), {
    from: row.fromLabel,
  })
  nudge(committeeId)
  return { success: true }
}
