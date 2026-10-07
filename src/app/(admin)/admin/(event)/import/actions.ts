"use server"

import ExcelJS from "exceljs"
import { prisma } from "@/lib/prisma"
import { requireStaff, requireAdmin } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { createDelegateFromRow } from "@/lib/intake"
import { getContent, setContent } from "@/lib/settings"
import { revalidatePath } from "next/cache"
import { automaticIntakeAllowed } from "@/lib/event-state"
import { CapabilityError, requireCapability } from "@/lib/event"
import { deriveCsvUrl } from "@/lib/gsheet-url"
import { fetchSheetRows, SheetFetchError } from "@/lib/sheet-fetch"
import { readableRowError, type ColumnMapping, type MappedRow } from "@/lib/schemas/import"
import { MAX_TABULAR_COLUMNS, MAX_TABULAR_ROWS, parseCsvRows } from "@/lib/tabular"

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

// Every step of this wizard asks first, so an event without cross delegations is
// refused before a file is read or a token is spent, not after the review.
async function crossDelegationRefusal(): Promise<string | null> {
  try {
    await requireCapability("crossDelegations")
    return null
  } catch (err) {
    if (err instanceof CapabilityError) return err.message
    throw err
  }
}

export async function parseUpload(formData: FormData): Promise<ParseResult> {
  await requireStaff()
  const refused = await crossDelegationRefusal()
  if (refused) return { success: false, error: refused }
  try {
    const file = formData.get("file") as File | null
    if (!file) return { success: false, error: "No file provided." }

    const ext = file.name.split(".").pop()?.toLowerCase()
    if (!["xlsx", "csv"].includes(ext ?? "")) {
      return { success: false, error: "Only .xlsx or .csv files are accepted." }
    }
    if (file.size > 10 * 1024 * 1024) return { success: false, error: "Keep import files under 10 MB." }

    const buffer = Buffer.from(await file.arrayBuffer())
    let rows: Record<string, unknown>[]
    let headers: string[]
    if (ext === "csv") {
      ;({ rows, headers } = parseCsvRows(buffer.toString("utf8")))
    } else {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
      const sheet = workbook.worksheets[0]
      if (!sheet) return { success: false, error: "No sheets found in the file." }
      if (sheet.rowCount - 1 > MAX_TABULAR_ROWS || sheet.columnCount > MAX_TABULAR_COLUMNS) {
        return { success: false, error: `Imports are limited to ${MAX_TABULAR_ROWS} rows and ${MAX_TABULAR_COLUMNS} columns.` }
      }
      headers = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((value) => String(value ?? "").trim())
      rows = []
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return
        const record = Object.fromEntries(headers.map((header, index) => [header, row.getCell(index + 1).text.trim()]))
        if (Object.values(record).some(Boolean)) rows.push(record)
      })
    }

    if (rows.length === 0) return { success: false, error: "The file has no data rows." }

    const stringRows = rows.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "").trim()])),
    ) as Record<string, string>[]

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
  // Of those created: how many got a draft seat from their choices. The rest
  // are accepted with nothing to pay and wait for a seat on Allotment.
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

  const refused = await crossDelegationRefusal()
  if (refused) {
    return {
      created: 0,
      allotted: 0,
      skipped: 0,
      quarantined: 0,
      errors: [{ row: 0, email: "", reason: refused }],
    }
  }

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
        // Auto-allotted seats are drafts: staff email them from Allotment.
        if (result.allotted) allotted++
      } else if (result.reason === "duplicate") {
        skipped++
        errors.push({ row: i, email: row.email, reason: "Email already registered, skipped." })
      } else {
        quarantined++
        errors.push({
          row: i,
          email: row.email,
          reason: `Needs fixing: ${result.errors.map(readableRowError).join(" · ")}`,
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
  // A cross-delegation row is confirmed and seated on creation, so it needs the
  // same permission as the import that produced it.
  if (q.source === "CROSS_DEL") {
    const refused = await crossDelegationRefusal()
    if (refused) return { success: false, error: refused }
  }

  const result = await createDelegateFromRow(fixedRow, q.source as "SELF" | "CROSS_DEL", {
    allottedBy: `quarantine:${session.user?.email ?? "staff"}`,
    presetName: q.presetName ?? undefined,
  })
  if (!result.ok) {
    return {
      success: false,
      error: result.reason === "duplicate" ? "Email already registered." : result.errors.map(readableRowError).join(" · "),
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

// ---------------------------------------------------------------------------
// Linked partner sheets, pulled daily by /api/cron/gform-sync
// ---------------------------------------------------------------------------

export interface PartnerSheet {
  presetName: string
  csvUrl: string
  source: "SELF" | "CROSS_DEL"
}

// Its own action rather than a generic content save, so a cross-delegation sheet
// cannot be linked to an event that takes none, and a bad link or a preset that
// does not exist is refused here instead of failing silently every night.
export async function savePartnerSheets(next: PartnerSheet[]): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  if (next.some((s) => s.source === "CROSS_DEL")) {
    const refused = await crossDelegationRefusal()
    if (refused) return { success: false, error: refused }
  }
  const presets = new Set((await prisma.importPreset.findMany({ select: { name: true } })).map((p) => p.name))
  const clean: PartnerSheet[] = []
  for (const s of next) {
    const csvUrl = deriveCsvUrl(s.csvUrl)
    if (!csvUrl) return { success: false, error: "That doesn't look like a Google Sheets link." }
    if (!presets.has(s.presetName)) return { success: false, error: `There is no import preset called "${s.presetName}".` }
    if (s.source !== "SELF" && s.source !== "CROSS_DEL") return { success: false, error: "Choose who these delegates are." }
    clean.push({ presetName: s.presetName, csvUrl, source: s.source })
  }
  await setContent({ sheetPullSources: clean })
  await audit(session.user?.email ?? "unknown", "partnerSheets.save", "Setting", "sheetPullSources", { count: clean.length })
  revalidatePath("/admin/import")
  return { success: true }
}

// "Review now" on a linked sheet: read it with its saved mapping and hand the
// rows to the same review an uploaded file gets, instead of waiting for the
// nightly pull to import whatever it finds.
export async function readPartnerSheet(presetName: string): Promise<
  | { success: true; headers: string[]; rows: Record<string, string>[]; mapping: ColumnMapping }
  | { success: false; error: string }
> {
  await requireStaff()
  const refused = await crossDelegationRefusal()
  if (refused) return { success: false, error: refused }
  const content = await getContent()
  const source = content.sheetPullSources.find((s) => s.presetName === presetName)
  const preset = await prisma.importPreset.findUnique({ where: { name: presetName } })
  if (!source || !preset) return { success: false, error: "That linked sheet or its preset no longer exists." }
  try {
    const { headers, rows } = await fetchSheetRows(source.csvUrl)
    const stringRows = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "").trim()])))
    return { success: true, headers, rows: stringRows, mapping: preset.mapping as ColumnMapping }
  } catch (err) {
    return { success: false, error: err instanceof SheetFetchError ? err.message : "The sheet could not be read." }
  }
}
