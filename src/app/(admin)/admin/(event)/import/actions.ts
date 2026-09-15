"use server"

import { read, utils } from "xlsx"
import { prisma } from "@/lib/prisma"
import { requireStaff, requireAdmin } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { createDelegateFromRow } from "@/lib/intake"
import { getContent } from "@/lib/settings"
import { automaticIntakeAllowed } from "@/lib/event-state"
import type { ColumnMapping, MappedRow } from "@/lib/schemas/import"

// ---------------------------------------------------------------------------
// Parse uploaded file
// ---------------------------------------------------------------------------

export interface ParseResult {
  success:   boolean
  error?:    string
  headers?:  string[]
  rows?:     Record<string, string>[]
  rowCount?: number
}

export async function parseUpload(formData: FormData): Promise<ParseResult> {
  await requireStaff()
  try {
    const file = formData.get("file") as File | null
    if (!file) return { success: false, error: "No file provided." }

    const ext = file.name.split(".").pop()?.toLowerCase()
    if (!["xlsx", "xls", "csv"].includes(ext ?? "")) {
      return { success: false, error: "Only .xlsx, .xls, or .csv files are accepted." }
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const wb = read(buffer, { type: "buffer", cellDates: true })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    if (!sheet) return { success: false, error: "No sheets found in the file." }

    const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    })

    if (rows.length === 0) return { success: false, error: "The file has no data rows." }

    const stringRows = rows.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "").trim()])),
    ) as Record<string, string>[]

    const headers = Object.keys(stringRows[0])
    return { success: true, headers, rows: stringRows, rowCount: stringRows.length }
  } catch {
    return { success: false, error: "Failed to parse file. Make sure it is a valid Excel or CSV file." }
  }
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export interface ImportPresetRecord {
  id:        string
  name:      string
  partner:   string | null
  mapping:   ColumnMapping
  createdAt: string
}

export async function getImportPresets(): Promise<ImportPresetRecord[]> {
  await requireStaff()
  const presets = await prisma.importPreset.findMany({ orderBy: { name: "asc" } })
  return presets.map((p) => ({
    id:        p.id,
    name:      p.name,
    partner:   p.partner,
    mapping:   p.mapping as ColumnMapping,
    createdAt: p.createdAt.toISOString(),
  }))
}

export async function saveImportPreset(
  name:    string,
  partner: string,
  mapping: ColumnMapping,
): Promise<{ success: boolean; error?: string; preset?: ImportPresetRecord }> {
  await requireStaff()
  if (!name.trim()) return { success: false, error: "Preset name is required." }
  try {
    const preset = await prisma.importPreset.upsert({
      where:  { name: name.trim() },
      create: { name: name.trim(), partner: partner || null, mapping },
      update: { partner: partner || null, mapping },
    })
    return {
      success: true,
      preset: {
        id:        preset.id,
        name:      preset.name,
        partner:   preset.partner,
        mapping:   preset.mapping as ColumnMapping,
        createdAt: preset.createdAt.toISOString(),
      },
    }
  } catch {
    return { success: false, error: "Failed to save preset." }
  }
}

export async function deleteImportPreset(id: string): Promise<{ success: boolean }> {
  await requireAdmin()
  await prisma.importPreset.delete({ where: { id } })
  return { success: true }
}

// ---------------------------------------------------------------------------
// Commit import, routed through the shared intake pipeline (lib/intake.ts).
// Invalid rows are quarantined, never silently dropped:
// created + allotted-in + duplicates + quarantined = total.
// ---------------------------------------------------------------------------

export interface CommitResult {
  created:     number
  allotted:    number
  skipped:     number
  quarantined: number
  errors:      { row: number; email: string; reason: string }[]
}

export async function commitImport(params: {
  rows:        MappedRow[]
  skippedRows: number[]
}): Promise<CommitResult> {
  const session = await requireStaff()
  const adminEmail = session.user?.email ?? "import"
  const { rows, skippedRows } = params
  const skippedSet = new Set(skippedRows)

  let created = 0
  let allotted = 0
  let skipped = 0
  let quarantined = 0
  const errors: CommitResult["errors"] = []

  const activeRows = rows.filter((_, i) => !skippedSet.has(i))

  // This wizard marks every row CONFIRMED and auto-allots it. During the Intra
  // MUN that would seat people with no review, so it refuses, and says where
  // Intra registrations go instead.
  const gate = automaticIntakeAllowed(await getContent(), "CROSS_DEL")
  if (!gate.ok) {
    return {
      created: 0,
      allotted: 0,
      skipped: activeRows.length,
      quarantined: 0,
      errors: activeRows.map((r, i) => ({
        row: i,
        email: r.email ?? "",
        reason: `${gate.reason} Intra MUN registrations are imported from Google Form responses instead.`,
      })),
    }
  }

  for (let i = 0; i < activeRows.length; i++) {
    const row = activeRows[i]
    try {
      const result = await createDelegateFromRow(row, "CROSS_DEL", {
        allottedBy: `import:${adminEmail}`,
      })

      if (result.ok) {
        created++
        if (result.allotted) {
          allotted++
          void import("@/lib/resend")
            .then(({ sendAllotmentEmail }) => sendAllotmentEmail(result.delegateId))
            .catch(() => undefined)
        }
      } else if (result.reason === "duplicate") {
        skipped++
        errors.push({ row: i, email: row.email, reason: "Email already registered, skipped." })
      } else {
        quarantined++
        errors.push({
          row: i,
          email: row.email,
          reason: `Quarantined for review: ${result.errors.join("; ")}`,
        })
      }
    } catch (err) {
      errors.push({
        row:    i,
        email:  row.email,
        reason: err instanceof Error ? err.message : "Unexpected error.",
      })
    }
  }

  await audit(adminEmail, "import.commit", "Delegate", undefined, {
    total: activeRows.length, created, allotted, skipped, quarantined,
  })

  return { created, allotted, skipped, quarantined, errors }
}

// ---------------------------------------------------------------------------
// Quarantine, rows that failed hard validation from any intake channel
// ---------------------------------------------------------------------------

export interface QuarantineRecord {
  id:        string
  source:    string
  raw:       MappedRow
  errors:    string[]
  createdAt: string
}

export async function getQuarantine(): Promise<QuarantineRecord[]> {
  await requireStaff()
  const rows = await prisma.quarantinedRow.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
  })
  return rows.map((r) => ({
    id:        r.id,
    source:    r.source,
    raw:       r.raw as MappedRow,
    errors:    r.errors,
    createdAt: r.createdAt.toISOString(),
  }))
}

export async function retryQuarantined(
  id: string,
  fixedRow: MappedRow,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  const q = await prisma.quarantinedRow.findUnique({ where: { id } })
  if (!q || q.resolvedAt) return { success: false, error: "Row not found or already resolved." }

  const result = await createDelegateFromRow(fixedRow, q.source as "SELF" | "CROSS_DEL", {
    allottedBy: `quarantine:${session.user?.email ?? "staff"}`,
    presetName: q.presetName ?? undefined,
  })
  if (!result.ok) {
    return {
      success: false,
      error: result.reason === "duplicate" ? "Email already registered." : result.errors.join("; "),
    }
  }
  await prisma.quarantinedRow.update({ where: { id }, data: { resolvedAt: new Date() } })
  await audit(session.user?.email ?? "unknown", "quarantine.retry", "QuarantinedRow", id)
  return { success: true }
}

export async function dismissQuarantined(id: string): Promise<{ success: boolean }> {
  const session = await requireStaff()
  await prisma.quarantinedRow.update({ where: { id }, data: { resolvedAt: new Date() } })
  await audit(session.user?.email ?? "unknown", "quarantine.dismiss", "QuarantinedRow", id)
  return { success: true }
}
