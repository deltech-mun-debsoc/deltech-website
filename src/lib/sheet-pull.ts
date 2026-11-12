// Linked partner sheets, pulled nightly by /api/cron/gform-sync. The last run's
// result per sheet is kept in this Setting so the screen can show it.
export const SHEET_PULL_HEALTH = "sheetPullHealth"

export interface SheetPullHealth {
  at: string
  rows: number
  created: number
  dedup: number
  quarantined: number
  error?: string
}

export function parseSheetPullHealth(raw: unknown): Record<string, SheetPullHealth> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, SheetPullHealth>) : {}
}
