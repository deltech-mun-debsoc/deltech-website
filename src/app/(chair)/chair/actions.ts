"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { audit } from "@/lib/audit"
import { t } from "@/content/strings"
import { resolveCommitteeViewer } from "@/lib/committee/viewer"
import { parseId } from "@/lib/committee/chat"
import type { CommitteeAttendance } from "@/generated/prisma/client"

const MARKS: readonly CommitteeAttendance[] = ["EXPECTED", "PRESENT", "PRESENT_AND_VOTING", "ABSENT", "LATE"]

// Last write wins, deliberately: a chair correcting a mis-marked seat must win
// over the earlier mark, and two chairs marking the same seat are agreeing about
// a fact in the room rather than racing for a resource.
//
// The session is looked up first so the guard can ask about its committee: a
// chair of one committee holding another committee's session id gets nothing.
export async function markAttendance(
  sessionId: unknown,
  portfolioId: unknown,
  status: unknown,
): Promise<{ success: boolean; error?: string }> {
  const sid = parseId(sessionId)
  const pid = parseId(portfolioId)
  if (!sid || !pid || !MARKS.includes(status as CommitteeAttendance)) {
    return { success: false, error: t("floor.errorNotAllowed") }
  }

  const live = await prisma.committeeSession.findUnique({
    where: { id: sid },
    select: { state: true, committeeId: true },
  })
  const viewer = live ? await resolveCommitteeViewer(live.committeeId) : null
  if (!live || viewer?.kind !== "dais") return { success: false, error: t("floor.errorNotAllowed") }
  if (live.state !== "ACTIVE") return { success: false, error: t("floor.errorNoSession") }

  const now = new Date()
  const result = await prisma.sessionAttendance.updateMany({
    where: { sessionId: sid, portfolioId: pid },
    data: { status: status as CommitteeAttendance, markedAt: now, markedById: viewer.email },
  })
  if (result.count === 0) return { success: false, error: t("floor.errorSeat") }

  await prisma.committeeSession.update({ where: { id: sid }, data: { lastActivityAt: now } })
  await audit(viewer.email, "committee_attendance_mark", "CommitteeSession", sid, { portfolioId: pid, status: status as CommitteeAttendance })
  revalidatePath("/chair")
  return { success: true }
}
