"use server"

import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { t } from "@/content/strings"
import { resolveCommitteeViewer } from "@/lib/committee/viewer"
import { moderateCommitteeMessage, nudge, sendCommitteeMessage, type SendResult } from "@/lib/committee/messages"
import { parseDraft, parseId, parseModerationAction } from "@/lib/committee/chat"

// The dais side of committee chat. requireStaff() comes first in each action so
// scripts/check-role-guards.ts pins them; resolveCommitteeViewer then confirms
// the committee is an online one in the running event.

const NOT_FOUND = () => t("committeeChat.errorNotAllowed")

export async function daisSendMessage(committeeId: unknown, draft: unknown): Promise<SendResult> {
  await requireStaff()
  const id = parseId(committeeId)
  const parsed = parseDraft(draft)
  if (!id || !parsed) return { success: false, error: NOT_FOUND() }
  const viewer = await resolveCommitteeViewer(id)
  if (viewer?.kind !== "dais") return { success: false, error: NOT_FOUND() }
  return sendCommitteeMessage(viewer, id, parsed)
}

export async function moderateMessage(
  committeeId: unknown,
  messageId: unknown,
  action: unknown,
): Promise<{ success: boolean; error?: string }> {
  await requireStaff()
  const id = parseId(committeeId)
  const act = parseModerationAction(action)
  if (!id || !act || typeof messageId !== "number" || !Number.isInteger(messageId)) {
    return { success: false, error: NOT_FOUND() }
  }
  const viewer = await resolveCommitteeViewer(id)
  if (viewer?.kind !== "dais") return { success: false, error: NOT_FOUND() }
  return moderateCommitteeMessage(viewer, id, messageId, act)
}

export async function setHoldDirectMessages(
  committeeId: unknown,
  on: unknown,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  const id = parseId(committeeId)
  if (!id || typeof on !== "boolean") return { success: false, error: NOT_FOUND() }
  const viewer = await resolveCommitteeViewer(id)
  if (viewer?.kind !== "dais") return { success: false, error: NOT_FOUND() }

  await prisma.committee.update({ where: { id }, data: { holdDirectMessages: on } })
  await audit(session.user?.email ?? "admin", on ? "committee_dm_hold_on" : "committee_dm_hold_off", "Committee", id, {})
  // Delegates' screens show whether their DMs will wait, so they need to know too.
  nudge(id)
  return { success: true }
}
