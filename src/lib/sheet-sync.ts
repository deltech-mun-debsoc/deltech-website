import { prisma } from "@/lib/prisma"
import { getContent } from "@/lib/settings"

export type SheetCellState = "available" | "allotted" | "paid"

// Mirrors one matrix cell to the public Google Sheet via the Apps Script web
// app (docs/apps-script/sheet-mirror.gs). Never throws, no-ops when
// sheetSyncUrl is unset. Returns whether the sheet accepted it, so a resync can
// say how many failed. The script answers HTTP 200 "unauthorized" on a wrong
// secret, which used to count as success.
export async function syncSheetCell(d: {
  committee: string
  portfolio: string
  state: SheetCellState
}): Promise<boolean> {
  try {
    const content = await getContent()
    if (!content.sheetSyncUrl) return false
    const res = await fetch(content.sheetSyncUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: process.env.SHEET_SYNC_SECRET ?? "", ...d }),
      signal: AbortSignal.timeout(4000),
      redirect: "follow", // Apps Script web apps respond via a 302 to script.googleusercontent.com
    })
    const body = res.ok ? (await res.text()).trim() : ""
    if (!res.ok || body === "unauthorized") {
      console.error("[sheet-sync]", res.status, body === "unauthorized" ? "wrong SHEET_SYNC_SECRET" : "", d.committee, d.portfolio)
      return false
    }
    return true
  } catch (err) {
    console.error("[sheet-sync]", err instanceof Error ? err.message : err, d.committee, d.portfolio)
    return false
  }
}

// For call sites that only have the delegateId (payment webhooks, mark-paid):
// looks the delegate's cell up and mirrors its current state.
export async function syncSheetForDelegate(delegateId: string): Promise<void> {
  try {
    const allotment = await prisma.allotment.findUnique({
      where: { delegateId },
      include: { portfolio: { include: { committee: true } }, delegate: true },
    })
    if (!allotment) return
    await syncSheetCell({
      committee: allotment.portfolio.committee.name,
      portfolio: allotment.portfolio.name,
      state: allotment.delegate.status === "CONFIRMED" ? "paid" : "allotted",
    })
  } catch (err) {
    console.error("[sheet-sync]", err instanceof Error ? err.message : err)
  }
}
