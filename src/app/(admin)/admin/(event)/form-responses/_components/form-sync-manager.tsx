"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Download, FileSpreadsheet, RefreshCw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { t, type StringKey } from "@/content/strings"
import { DELEGATE_IMPORT_FIELDS, type DelegateMapping } from "@/lib/schemas/delegate-import"
import {
  applyFormImport,
  previewFormImport,
  readSheetColumns,
  saveFormSource,
  type FormPreviewResult,
} from "../actions"

interface Source {
  id: string
  label: string
  sheetUrl: string
  sheetKey: string
  mapping: Partial<DelegateMapping>
  lastImported: string | null
}

const OUTCOME_LABEL: Record<string, StringKey> = {
  create: "admin.formSync.outcomeCreate",
  update: "admin.formSync.outcomeUpdate",
  "skip-unchanged": "admin.formSync.outcomeSkipUnchanged",
  "skip-duplicate": "admin.formSync.outcomeSkipDuplicate",
  invalid: "admin.formSync.outcomeInvalid",
}

// Same tones as recruitment's responses screen, so the two importers read alike.
const OUTCOME_TONE: Record<string, string> = {
  create: "bg-[var(--teal-100)] text-[var(--teal-700)]",
  update: "bg-secondary text-secondary-foreground",
  "skip-unchanged": "bg-muted text-muted-foreground",
  "skip-duplicate": "bg-accent text-accent-foreground",
  invalid: "bg-[var(--signal-soft)] text-[var(--ink-soft)]",
}

const REQUIRED = DELEGATE_IMPORT_FIELDS.filter((f) => f.required).map((f) => f.key)

export function FormSyncManager({ sources, defaultMapping }: { sources: Source[]; defaultMapping: DelegateMapping }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [activeId, setActiveId] = useState<string | null>(sources[0]?.id ?? null)
  const [preview, setPreview] = useState<FormPreviewResult | null>(null)
  const [overrides, setOverrides] = useState<Record<string, number>>({})

  // Editor. Opens for a new source when none exist, since that is the only thing
  // a first-time organiser can usefully do on this page.
  const [editing, setEditing] = useState<string | "new" | null>(sources.length === 0 ? "new" : null)
  const [label, setLabel] = useState("")
  const [sheetUrl, setSheetUrl] = useState("")
  const [headers, setHeaders] = useState<string[] | null>(null)
  const [mapping, setMapping] = useState<Partial<DelegateMapping>>({})

  function openEditor(source: Source | null) {
    setEditing(source ? source.id : "new")
    setLabel(source?.label ?? "")
    setSheetUrl(source?.sheetUrl ?? "")
    setMapping(source ? source.mapping : {})
    setHeaders(null)
  }

  function doPreview(sourceId: string, next = overrides) {
    setActiveId(sourceId)
    startTransition(async () => {
      const result = await previewFormImport({ sourceId, duplicateOverrides: next })
      setPreview(result)
      if (!result.ok) toast.error(result.error)
    })
  }

  function doApply(sourceId: string) {
    startTransition(async () => {
      const result = await applyFormImport({ sourceId, duplicateOverrides: overrides })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.idempotent
          ? t("admin.formSync.importedNothing")
          : t("admin.formSync.importedResult", { created: result.created, updated: result.updated, invalid: result.invalid }),
      )
      setPreview(null)
      setOverrides({})
      router.refresh()
    })
  }

  function doReadColumns() {
    startTransition(async () => {
      const result = await readSheetColumns({ sheetUrl })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setHeaders(result.headers)
      // Keep a choice the organiser already made if that column still exists;
      // otherwise take the suggestion; otherwise the Intra form's own header.
      setMapping((prev) => {
        const next: Partial<DelegateMapping> = {}
        for (const f of DELEGATE_IMPORT_FIELDS) {
          const keep = prev[f.key] && result.headers.includes(prev[f.key]!) ? prev[f.key] : undefined
          const fallback = result.headers.includes(defaultMapping[f.key] ?? "") ? defaultMapping[f.key] : undefined
          const chosen = keep ?? result.suggested[f.key] ?? fallback
          if (chosen) next[f.key] = chosen
        }
        return next
      })
    })
  }

  function doSave() {
    startTransition(async () => {
      const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v && v.trim())) as DelegateMapping
      const result = await saveFormSource({ label, sheetUrl, mapping: clean })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(t("admin.formSync.saved"))
      setEditing(null)
      setActiveId(result.sourceId)
      router.refresh()
    })
  }

  const missing = REQUIRED.filter((k) => !mapping[k])
  const missingLabels = DELEGATE_IMPORT_FIELDS.filter((f) => missing.includes(f.key as (typeof REQUIRED)[number])).map((f) => f.label)
  const canSave = !!label.trim() && !!sheetUrl.trim() && missing.length === 0

  const attention = preview?.ok ? preview.rows.filter((r) => r.errors.length > 0 || r.warnings.length > 0) : []

  return (
    <div className="space-y-8">
      {/* ---- Connected sheets ---- */}
      <section className="space-y-3">
        <h2 className="section-label">{t("admin.formSync.sourcesTitle")}</h2>
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.formSync.noSources")}</p>
        ) : (
          <ul className="space-y-2">
            {sources.map((s) => {
              const previewed = preview?.ok && activeId === s.id
              return (
                <li key={s.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <FileSpreadsheet className="size-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{s.label}</p>
                        <p className="text-sm text-muted-foreground">
                          {s.lastImported ? t("admin.formSync.lastSynced", { when: s.lastImported }) : t("admin.formSync.neverSynced")}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => openEditor(s)}>
                        {t("admin.formSync.editSource")}
                      </Button>
                      <Button variant="outline" className="gap-1.5" disabled={pending} onClick={() => doPreview(s.id)}>
                        <RefreshCw className="size-4" />
                        {pending && activeId === s.id && !previewed ? t("admin.formSync.previewing") : t("admin.formSync.preview")}
                      </Button>
                      <Button className="gap-1.5" disabled={pending || !previewed} onClick={() => doApply(s.id)}>
                        <Download className="size-4" />
                        {t("admin.formSync.apply")}
                      </Button>
                    </div>
                    {!previewed && <p className="w-full text-sm text-muted-foreground">{t("admin.formSync.previewFirst")}</p>}
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ---- Preview: exactly the plan that Import will run ---- */}
      {preview?.ok && (
        <section className="space-y-4">
          <h2 className="section-label">{t("admin.formSync.previewTitle")}</h2>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ["create", preview.counts.create, "admin.formSync.countCreate"],
                ["update", preview.counts.update, "admin.formSync.countUpdate"],
                ["skip-unchanged", preview.counts.skipUnchanged, "admin.formSync.countUnchanged"],
                ["skip-duplicate", preview.counts.skipDuplicate, "admin.formSync.countDuplicate"],
                ["invalid", preview.counts.invalid, "admin.formSync.countInvalid"],
              ] as const
            ).map(([tone, n, key]) => (
              <Badge key={tone} className={`px-2.5 py-1 text-sm font-medium ${OUTCOME_TONE[tone]}`}>
                {t(key, { n })}
              </Badge>
            ))}
          </div>

          {preview.alreadyApplied && (
            <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">{t("admin.formSync.alreadyApplied")}</p>
          )}

          {/* What needs a human, first: it is the only part that asks for action. */}
          <div className="space-y-2 rounded-md border border-border/70 p-4">
            <h3 className="flex items-center gap-2 font-medium">
              <TriangleAlert className="size-4 text-muted-foreground" />
              {t("admin.formSync.attentionTitle", { n: attention.length })}
            </h3>
            {attention.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("admin.formSync.noAttention")}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{t("admin.formSync.attentionHelp")}</p>
                <ul className="divide-y divide-border/60">
                  {attention.map((r) => (
                    <li key={r.index} className="py-2 text-sm">
                      <p className="font-medium">
                        {t("admin.formSync.duplicateRow", { row: r.index + 2 })}
                        {r.fullName ? `  ·  ${r.fullName}` : ""}
                        {r.email ? `  ·  ${r.email}` : ""}
                      </p>
                      {[...r.errors, ...r.warnings].map((m, i) => (
                        <p key={i} className="text-muted-foreground">{m}</p>
                      ))}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {preview.duplicateGroups.length > 0 && (
            <div className="space-y-2 rounded-md border border-border/70 p-4">
              <h3 className="font-medium">{t("admin.formSync.duplicatesTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t("admin.formSync.duplicatesHelp")}</p>
              <ul className="space-y-3">
                {preview.duplicateGroups.map((g) => (
                  <li key={g.email} className="text-sm">
                    <p className="font-medium">{g.email}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {g.rowIndexes.map((i) => {
                        const kept = i === g.winnerIndex
                        const row = preview.rows.find((r) => r.index === i)
                        return (
                          <Button
                            key={i}
                            size="sm"
                            variant={kept ? "default" : "outline"}
                            className="h-auto flex-col items-start gap-0.5 py-1.5 text-left"
                            disabled={pending}
                            onClick={() => {
                              const next = { ...overrides, [g.email]: i }
                              setOverrides(next)
                              if (activeId) doPreview(activeId, next)
                            }}
                          >
                            <span className="text-xs font-medium">{row?.submittedAt ?? t("admin.formSync.duplicateRow", { row: i + 2 })}</span>
                            <span className="text-[0.75rem] opacity-80">{kept ? t("admin.formSync.duplicateKept") : t("admin.formSync.duplicateUse")}</span>
                          </Button>
                        )
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="max-h-[28rem] overflow-auto rounded-md border border-border/70">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border/70">
                  <th className="px-3 py-2 font-medium">{t("admin.formSync.tableRow")}</th>
                  <th className="px-3 py-2 font-medium">{t("admin.formSync.tableStatus")}</th>
                  <th className="px-3 py-2 font-medium">{t("admin.formSync.tableName")}</th>
                  <th className="px-3 py-2 font-medium">{t("admin.formSync.tableEmail")}</th>
                  <th className="px-3 py-2 font-medium">{t("admin.formSync.tableRoll")}</th>
                  <th className="px-3 py-2 font-medium">{t("admin.formSync.tableChoices")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.index} className="border-b border-border/40 align-top last:border-0">
                    {/* +2: sheet rows start at 1 and row 1 is the header, so this
                        is the number the organiser sees in Google Sheets. */}
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{r.index + 2}</td>
                    <td className="px-3 py-2">
                      <Badge className={`font-normal ${OUTCOME_TONE[r.outcome] ?? ""}`}>{t(OUTCOME_LABEL[r.outcome] ?? "admin.formSync.outcomeInvalid")}</Badge>
                    </td>
                    <td className="px-3 py-2">{r.fullName}</td>
                    <td className="px-3 py-2">
                      <span className="block break-all">{r.email}</span>
                      {r.protectedFields.length > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {t("admin.formSync.protectedNote", { fields: r.protectedFields.join(", ") })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.rollNumber}</td>
                    <td className="px-3 py-2">{r.choices}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {activeId && (
            <Button size="lg" className="gap-1.5" disabled={pending} onClick={() => doApply(activeId)}>
              <Download className="size-4" />
              {pending ? t("admin.formSync.applying") : t("admin.formSync.apply")}
            </Button>
          )}
        </section>
      )}

      {/* ---- Connect or change a sheet ---- */}
      {editing ? (
        <section className="space-y-3">
          <h2 className="section-label">{editing === "new" ? t("admin.formSync.addSource") : t("admin.formSync.editSource")}</h2>
          <Card className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="src-label">{t("admin.formSync.labelLabel")}</Label>
                <Input id="src-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("admin.formSync.labelPlaceholder")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="src-url">{t("admin.formSync.sheetUrlLabel")}</Label>
                <Input id="src-url" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder={t("admin.formSync.sheetUrlPlaceholder")} />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{t("admin.formSync.shareHint")}</p>

            <Button variant="outline" className="gap-1.5" disabled={pending || !sheetUrl.trim()} onClick={doReadColumns}>
              <RefreshCw className="size-4" />
              {pending ? t("admin.formSync.readingColumns") : t("admin.formSync.readColumns")}
            </Button>

            <div className="space-y-2">
              <h3 className="font-medium">{t("admin.formSync.mappingTitle")}</h3>
              <p className="text-sm text-muted-foreground">
                {headers ? t("admin.formSync.mappingHelp") : t("admin.formSync.mappingNeedsRead")}
              </p>
              {headers && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {DELEGATE_IMPORT_FIELDS.map((f) => (
                    <div key={f.key} className="space-y-1.5">
                      <Label htmlFor={`map-${f.key}`}>
                        {f.label}
                        {f.required && " *"}
                      </Label>
                      {/* A native select from the sheet's real headers: nobody has
                          to type a column name exactly, and a renamed question
                          shows up as a missing choice instead of a silent miss. */}
                      <select
                        id={`map-${f.key}`}
                        className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
                        value={mapping[f.key] ?? ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, [f.key]: e.target.value || undefined }))}
                      >
                        <option value="">{t("admin.formSync.mappingUnmapped")}</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h.split("\n")[0]}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {headers && missing.length > 0 && (
              <p className="text-sm text-muted-foreground">{t("admin.formSync.mappingMissing", { fields: missingLabels.join(", ") })}</p>
            )}
            {!canSave && <p className="text-sm text-muted-foreground">{t("admin.formSync.sourceIncomplete")}</p>}

            <div className="flex gap-2">
              <Button disabled={pending || !canSave} onClick={doSave}>
                {t("admin.formSync.save")}
              </Button>
              {sources.length > 0 && (
                <Button variant="ghost" disabled={pending} onClick={() => setEditing(null)}>
                  {t("common.cancel")}
                </Button>
              )}
            </div>
          </Card>
        </section>
      ) : (
        <Button variant="outline" onClick={() => openEditor(null)}>
          {t("admin.formSync.addSource")}
        </Button>
      )}
    </div>
  )
}
