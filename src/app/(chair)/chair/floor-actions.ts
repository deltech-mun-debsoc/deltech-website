"use server"

import { t } from "@/content/strings"
import { resolveCommitteeViewer } from "@/lib/committee/viewer"
import { parseId } from "@/lib/committee/chat"
import { parseDaisOp } from "@/lib/committee/floor"
import { runDaisOp, type FloorResult } from "@/lib/committee/floor-server"

// Every dais change to the floor goes through this one action, so there is one
// guard and one parser to get right. The guard is resolveCommitteeViewer, which
// says "dais" only for this committee's chairs; the version makes a stale screen
// lose.
export async function floorDaisAction(committeeId: unknown, expectedVersion: unknown, op: unknown): Promise<FloorResult> {
  const id = parseId(committeeId)
  const parsed = parseDaisOp(op)
  if (!id || !parsed || typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion)) {
    return { success: false, error: t("floor.errorNotAllowed") }
  }
  const viewer = await resolveCommitteeViewer(id)
  if (viewer?.kind !== "dais") return { success: false, error: t("floor.errorNotAllowed") }
  return runDaisOp(viewer, id, expectedVersion, parsed)
}
