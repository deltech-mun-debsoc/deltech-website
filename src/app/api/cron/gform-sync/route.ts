import { NextRequest, NextResponse } from "next/server"
import { read, utils } from "xlsx"
import { prisma } from "@/lib/prisma"
import { getContent } from "@/lib/settings"
import { automaticIntakeAllowed } from "@/lib/event-state"
import { createDelegateFromRow } from "@/lib/intake"
import { applyMapping, type ColumnMapping } from "@/lib/schemas/import"

// Daily self-heal for Google Form intake (vercel.json cron). Pulls each
// published-CSV URL from the sheetPullSources setting and re-runs every row
// through the shared pipeline. Duplicates skip silently (unique email index),
// so this is safe to run any number of times.

export async function GET(req: NextRequest) {
  // Fail closed: no configured secret means no access (never world-callable).
  const authHeader = req.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const content = await getContent()
  const results: Record<string, { created: number; dedup: number; quarantined: number; error?: string }> = {}

  for (const src of content.sheetPullSources) {
    const stats = { created: 0, dedup: 0, quarantined: 0 } as {
      created: number
      dedup: number
      quarantined: number
      error?: string
    }
    results[src.presetName] = stats

    const gate = automaticIntakeAllowed(content, src.source === "CROSS_DEL" ? "CROSS_DEL" : "SELF")
    if (!gate.ok) {
      stats.error = gate.reason
      continue
    }

    try {
      const preset = await prisma.importPreset.findUnique({ where: { name: src.presetName } })
      if (!preset) {
        stats.error = "preset not found"
        continue
      }

      const res = await fetch(src.csvUrl, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) {
        stats.error = `fetch ${res.status}`
        continue
      }
      const csv = await res.text()
      const wb = read(csv, { type: "string" })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false })

      for (const raw of rows) {
        const stringRow = Object.fromEntries(
          Object.entries(raw).map(([k, v]) => [k, String(v ?? "").trim()]),
        ) as Record<string, string>
        const mapped = applyMapping(stringRow, preset.mapping as ColumnMapping)
        if (!mapped.email) continue // blank sheet row

        const result = await createDelegateFromRow(mapped, src.source, {
          sourceNote: `gform-sync:${src.presetName}`,
          allottedBy: `gform-sync:${src.presetName}`,
          presetName: src.presetName,
        })
        if (result.ok) stats.created++
        else if (result.reason === "duplicate") stats.dedup++
        else stats.quarantined++
      }
    } catch (err) {
      stats.error = err instanceof Error ? err.message : String(err)
    }
  }

  return NextResponse.json({ results })
}
