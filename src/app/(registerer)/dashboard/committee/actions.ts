"use server"

import { t } from "@/content/strings"
import { resolveCommitteeViewer } from "@/lib/committee/viewer"
import { sendCommitteeMessage, type SendResult } from "@/lib/committee/messages"
import { parseDraft, parseId } from "@/lib/committee/chat"

// A delegate's only write in committee chat. The route group's layout does not
// guard a server action, which is a public POST endpoint: the guard is
// resolveCommitteeViewer, which demands a verified account holding a seat in
// this online committee in the running event.
export async function delegateSendMessage(committeeId: unknown, draft: unknown): Promise<SendResult> {
  const id = parseId(committeeId)
  const parsed = parseDraft(draft)
  if (!id || !parsed) return { success: false, error: t("committeeChat.errorNotAllowed") }
  const viewer = await resolveCommitteeViewer(id)
  if (viewer?.kind !== "delegate") return { success: false, error: t("committeeChat.errorNotAllowed") }
  return sendCommitteeMessage(viewer, id, parsed)
}
