"use server"

import { t } from "@/content/strings"
import { resolveCommitteeViewer } from "@/lib/committee/viewer"
import { parseId } from "@/lib/committee/chat"
import { parseDelegateOp } from "@/lib/committee/floor"
import { runDelegateOp, type FloorResult } from "@/lib/committee/floor-server"

// A delegate's only writes to the floor: asking to speak, proposing or
// withdrawing a motion, and voting. The parser has no dais operations in it, so
// none can be reached from here, and the viewer check demands a verified account
// seated in this committee.
export async function floorDelegateAction(committeeId: unknown, op: unknown): Promise<FloorResult> {
  const id = parseId(committeeId)
  const parsed = parseDelegateOp(op)
  if (!id || !parsed) return { success: false, error: t("floor.errorNotAllowed") }
  const viewer = await resolveCommitteeViewer(id)
  if (viewer?.kind !== "delegate") return { success: false, error: t("floor.errorNotAllowed") }
  return runDelegateOp(viewer, id, parsed)
}
