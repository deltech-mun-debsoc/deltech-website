"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Copy, Download, FileSpreadsheet, LockKeyhole, RefreshCw, TriangleAlert } from "lucide-react"
import { ImportReview } from "./import-review"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { t } from "@/content/strings"
import { DELEGATE_IMPORT_FIELDS, type DelegateMapping } from "@/lib/schemas/delegate-import"
import {
  applyFormImport,
  previewFormImport,
  readSheetColumns,
  saveFormSource,
  saveImportResolution,
  type FormPreviewResult,
  type ResolutionPatch,
} from "../actions"

export interface FormSource {
  id: string
  label: string
  sheetUrl: string
  sheetKey: string
  mapping: Partial<DelegateMapping>
  lastImported: string | null
  lastChecked: string | null
  lastCheckRows: number | null
  lastCheckNeedsAction: number | null
  lastCheckError: string | null
  lastAccess: string | null
}

const REQUIRED = DELEGATE_IMPORT_FIELDS.filter((f) => f.required).map((f) => f.key)

type Preview = Extract<FormPreviewResult, { ok: true }>

export function FormSyncManager({
  sources,
  defaultMapping,
  eventName,
  bot,
  committees,
}: {
  sources: FormSource[]
  committees: { id: string; name: string }[]
  defaultMapping: DelegateMapping
  eventName: string
  // The service account staff share a sheet with to keep it private.
  bot: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // The preview carries its own source id and plan token, so Import can only
  // ever act on the source that was checked, with exactly what was shown.
  const [preview, setPreview] = useState<Preview | null>(null)
  const [checking, setChecking] = useState<string | null>(null)

  // Editor. Opens for a new source when none exist, since that is the only thing
  // a first-time organiser can usefully do on this page.
  const [editing, setEditing] = useState<string | "new" | null>(sources.length === 0 ? "new" : null)
  const [label, setLabel] = useState("")
  const [sheetUrl, setSheetUrl] = useState("")
  const [headers, setHeaders] = useState<string[] | null>(null)
  const [mapping, setMapping] = useState<Partial<DelegateMapping>>({})

  function forgetPreview() {
    setPreview(null)
  }

  function openEditor(source: FormSource | null) {
    forgetPreview()
    setEditing(source ? source.id : "new")
    setLabel(source?.label ?? "")
    setSheetUrl(source?.sheetUrl ?? "")
    setMapping(source ? source.mapping : {})
    setHeaders(null)
  }

  function doPreview(sourceId: string) {
    if (preview?.sourceId !== sourceId) setPreview(null)
    setChecking(sourceId)
    startTransition(async () => {
      const result = await previewFormImport({ sourceId })
      setChecking(null)
      if (!result.ok) {
        setPreview(null)
        toast.error(result.error)
        router.refresh()
        return
      }
      setPreview(result)
      router.refresh()
    })
  }

  function doApply() {
    if (!preview) return
    startTransition(async () => {
      const result = await applyFormImport({ sourceId: preview.sourceId, planToken: preview.planToken })
      if (!result.ok) {
        toast.error(result.error)
        // A stale preview is not shown as if it were still true.
        if (result.stale) forgetPreview()
        return
      }
      toast.success(
        result.idempotent
          ? t("admin.formSync.importedNothing")
          : t("admin.formSync.importedResult", { created: result.created, updated: result.updated, invalid: result.invalid }),
      )
      forgetPreview()
      router.refresh()
    })
  }

  // An answer is kept on the source, then the sheet is checked again with it, so
  // the review always shows the plan Import would run.
  function doResolve(patch: ResolutionPatch) {
    if (!preview) return
    const sourceId = preview.sourceId
    startTransition(async () => {
      const saved = await saveImportResolution({ sourceId, patch })
      if (!saved.ok) {
        toast.error(saved.error)
        return
      }
      const result = await previewFormImport({ sourceId })
      if (!result.ok) {
        setPreview(null)
        toast.error(result.error)
        return
      }
      setPreview(result)
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
      const result = await saveFormSource({
        sourceId: editing && editing !== "new" ? editing : undefined,
        label,
        sheetUrl,
        mapping: clean,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(t("admin.formSync.saved"))
      setEditing(null)
      forgetPreview()
      router.refresh()
    })
  }

  const missing = REQUIRED.filter((k) => !mapping[k])
  const missingLabels = DELEGATE_IMPORT_FIELDS.filter((f) => missing.includes(f.key as (typeof REQUIRED)[number])).map((f) => f.label)
  const canSave = !!label.trim() && !!sheetUrl.trim() && missing.length === 0

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
              const previewed = preview?.sourceId === s.id
              return (
                <li key={s.id}>
                  <Card className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{s.label}</p>
                          <p className="text-sm text-muted-foreground">
                            {t("admin.formSync.forEvent", { event: eventName })}
                            {" · "}
                            {s.lastImported ? t("admin.formSync.lastSynced", { when: s.lastImported }) : t("admin.formSync.neverSynced")}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="ghost" size="sm" disabled={pending} onClick={() => openEditor(s)}>
                          {t("admin.formSync.manageSource")}
                        </Button>
                        <Button variant="outline" className="gap-1.5" disabled={pending} onClick={() => doPreview(s.id)}>
                          <RefreshCw className="size-4" />
                          {checking === s.id ? t("admin.formSync.previewing") : t("admin.formSync.preview")}
                        </Button>
                        <Button className="gap-1.5" disabled={pending || !previewed} onClick={doApply}>
                          <Download className="size-4" />
                          {t("admin.formSync.apply")}
                        </Button>
                      </div>
                    </div>
                    {/* Source health, in one quiet line, and one more only when
                        the sheet is exposed or the last check failed. */}
                    <p className="text-xs text-muted-foreground">
                      {s.lastChecked
                        ? t("admin.formSync.checked", { when: s.lastChecked, rows: s.lastCheckRows ?? 0, needs: s.lastCheckNeedsAction ?? 0 })
                        : t("admin.formSync.neverChecked")}
                      {" · "}
                      {t("admin.formSync.automaticOff")}
                    </p>
                    {s.lastCheckError && (
                      <p className="flex items-start gap-2 text-sm text-destructive">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                        {t("admin.formSync.checkFailed", { error: s.lastCheckError })}
                      </p>
                    )}
                    {s.lastAccess === "public" && (
                      <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                        {t("admin.formSync.publicSheet")}
                      </p>
                    )}
                    {s.lastAccess === "private" && bot && (
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <LockKeyhole className="size-3.5" />
                        {t("admin.formSync.privateSheet", { bot })}
                      </p>
                    )}
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ---- Review: exactly the plan that Import will run ---- */}
      {preview && (
        <ImportReview preview={preview} committees={committees} pending={pending} onResolve={doResolve} onImport={doApply} />
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
            {/* The one step that keeps the sheet private, said where the sheet is
                connected. Without a service account, the exposure is said plainly. */}
            {bot ? (
              <div className="space-y-2 rounded-md border border-border/70 p-3 text-sm">
                <p className="text-muted-foreground">{t("admin.formSync.shareBot")}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-muted px-2 py-1 text-xs">{bot}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      void navigator.clipboard.writeText(bot)
                      toast.success(t("admin.formSync.copiedBot"))
                    }}
                  >
                    <Copy className="size-3.5" />
                    {t("admin.formSync.copyBot")}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {t("admin.formSync.shareHint")}
              </p>
            )}

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
        sources.length === 0 && (
          <Button variant="outline" onClick={() => openEditor(null)}>
            {t("admin.formSync.addSource")}
          </Button>
        )
      )}
    </div>
  )
}
