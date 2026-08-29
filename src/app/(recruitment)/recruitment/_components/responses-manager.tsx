"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Download, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { t } from "@/content/strings"
import { CANDIDATE_IMPORT_FIELDS, type CandidateMapping } from "@/lib/schemas/recruitment"
import { applyImport, previewImport, saveSheetSource, type PreviewResult } from "../import-actions"

interface Source {
  id: string
  label: string
  sheetUrl: string
  sheetKey: string
  isActive: boolean
  // Partial: a stored mapping from an older schema may be missing fields, and it is
  // only used here to prefill placeholders.
  mapping: Partial<CandidateMapping>
}

const OUTCOME_LABEL: Record<string, string> = {
  create: "recruitment.responses.outcomeCreate",
  update: "recruitment.responses.outcomeUpdate",
  "skip-unchanged": "recruitment.responses.outcomeSkipUnchanged",
  "skip-duplicate": "recruitment.responses.outcomeSkipDuplicate",
  invalid: "recruitment.responses.outcomeInvalid",
}

const OUTCOME_TONE: Record<string, string> = {
  create: "bg-[var(--teal-100)] text-[var(--teal-700)]",
  update: "bg-secondary text-secondary-foreground",
  "skip-unchanged": "bg-muted text-muted-foreground",
  "skip-duplicate": "bg-accent text-accent-foreground",
  invalid: "bg-[var(--signal-soft)] text-[var(--ink-soft)]",
}

// The most human-readable thing that distinguishes two submissions from the same
// person: the submission time when the sheet has one, else the first answer that
// looks like a date, else nothing (the caller falls back to a row number).
function describeSubmission(raw: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(raw)) {
    if (!value?.trim()) continue
    if (/timestamp|submitted|date|time/i.test(key)) return value.trim()
  }
  return null
}

export function ResponsesManager({
  cycleId,
  sources,
  canConfigure,
  canApply,
}: {
  cycleId: string
  sources: Source[]
  canConfigure: boolean
  canApply: boolean
}) {
  const router = useRouter()
  const [activeId, setActiveId] = useState(sources[0]?.id ?? null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  // { email: rowIndex } the operator picked for a duplicate, overriding the
  // automatic (latest submission) winner.
  const [duplicateOverrides, setDuplicateOverrides] = useState<Record<string, number>>({})
  const [pending, startTransition] = useTransition()

  // Source editor state (admins only).
  const [label, setLabel] = useState("")
  const [sheetUrl, setSheetUrl] = useState("")
  const [mapping, setMapping] = useState<Record<string, string>>({})

  const active = sources.find((s) => s.id === activeId) ?? null

  // The editor used to start empty with the stored values as PLACEHOLDERS, and
  // saveSheetSource writes the mapping wholesale: adding a timestamp column meant
  // retyping label, URL and every other field, and silently dropping whichever one
  // you forgot. Seed from the source being edited instead.
  useEffect(() => {
    if (!active) return
    setLabel(active.label)
    setSheetUrl(active.sheetUrl)
    setMapping(Object.fromEntries(Object.entries(active.mapping).filter(([, v]) => v)) as Record<string, string>)
  }, [active])

  function doPreview(sourceId: string, overrides = duplicateOverrides) {
    startTransition(async () => {
      const result = await previewImport({ cycleId, sourceId, duplicateOverrides: overrides })
      setPreview(result)
      if (!result.ok) toast.error(result.error)
    })
  }

  function doApply(sourceId: string) {
    startTransition(async () => {
      const result = await applyImport({ cycleId, sourceId, duplicateOverrides })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      // An idempotent apply is a success that changed nothing: say which happened.
      toast.success(
        result.idempotent
          ? t("recruitment.responses.importedNothing")
          : t("recruitment.responses.importedResult", {
              created: result.created,
              updated: result.updated,
              skipped: result.skipped,
              invalid: result.invalid,
            }),
      )
      setPreview(null)
      router.refresh()
    })
  }

  function doSaveSource() {
    startTransition(async () => {
      const result = await saveSheetSource({
        cycleId,
        label,
        sheetUrl,
        // Empty strings are not "unmapped": z.string().min(1).optional() REJECTS
        // "", which stored an unparseable source and hard-failed both preview and
        // apply with "column mapping is incomplete".
        mapping: Object.fromEntries(
          Object.entries(mapping).filter(([, v]) => v.trim()),
        ) as CandidateMapping,
      })
      if (!result.ok) {
        toast.error(result.error ?? t("recruitment.errors.generic"))
        return
      }
      toast.success(t("recruitment.responses.save"))
      setLabel("")
      setSheetUrl("")
      setMapping({})
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="section-label">
          {t("recruitment.responses.sourcesTitle")}
        </h2>

        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("recruitment.responses.noSources")}</p>
        ) : (
          <ul className="space-y-2">
            {sources.map((s) => (
              <li key={s.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.sheetKey}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={pending}
                      onClick={() => {
                        setActiveId(s.id)
                        doPreview(s.id)
                      }}
                    >
                      <RefreshCw className="size-3.5" />
                      {pending && activeId === s.id
                        ? t("recruitment.responses.previewing")
                        : t("recruitment.responses.preview")}
                    </Button>
                    {canApply && (
                      <Button
                        size="sm"
                        className="gap-1.5"
                        // Applying without previewing skipped the duplicate picker
                        // entirely: an operator never saw that two submissions were
                        // collapsed, let alone which one won.
                        disabled={pending || !(preview?.ok && activeId === s.id)}
                        title={
                          preview?.ok && activeId === s.id
                            ? undefined
                            : t("recruitment.responses.previewFirst")
                        }
                        onClick={() => doApply(s.id)}
                      >
                        <Download className="size-3.5" />
                        {t("recruitment.responses.apply")}
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t("recruitment.responses.shareHint")}</p>
      </section>

      {/* ---- Preview: exactly the plan that apply will execute ---- */}
      {preview?.ok && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="section-label">
              {t("recruitment.responses.previewTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">{preview.summary}</p>
          </div>

          {preview.alreadyApplied && (
            <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
              {t("recruitment.responses.alreadyApplied")}
            </p>
          )}

          {preview.duplicateGroups.length > 0 && (
            <div className="space-y-2 rounded-md border border-border/70 p-3">
              <h3 className="section-label">{t("recruitment.responses.duplicatesTitle")}</h3>
              <p className="text-xs text-muted-foreground">
                {t("recruitment.responses.duplicatesHelp")}
              </p>
              <ul className="space-y-2">
                {preview.duplicateGroups.map((g) => (
                  <li key={g.email} className="text-sm">
                    <p className="font-medium">{g.email}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {g.rowIndexes.map((i) => {
                        const kept = i === g.winnerIndex
                        const row = preview.rows.find((r) => r.index === i)
                        // "Row 3 vs Row 17" is not a choice anyone can make. Show
                        // what actually distinguishes the two submissions.
                        const stamp = row ? describeSubmission(row.raw) : null
                        return (
                          <Button
                            key={i}
                            type="button"
                            size="sm"
                            variant={kept ? "default" : "outline"}
                            className="h-auto flex-col items-start gap-0.5 py-1.5 text-left"
                            disabled={pending}
                            onClick={() => {
                              const next = { ...duplicateOverrides, [g.email]: i }
                              setDuplicateOverrides(next)
                              if (activeId) doPreview(activeId, next)
                            }}
                          >
                            <span className="text-xs font-medium">
                              {stamp ?? t("recruitment.responses.duplicateRow", { row: i + 1 })}
                            </span>
                            <span className="text-[0.7rem] opacity-80">
                              {kept
                                ? t("recruitment.responses.duplicateKept")
                                : t("recruitment.responses.duplicateUse")}
                            </span>
                          </Button>
                        )
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="max-h-96 overflow-auto rounded-md border border-border/70">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border/70">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">
                    {t("recruitment.responses.outcomeCreate")}
                  </th>
                  <th className="px-3 py-2 font-medium">{t("recruitment.control.nameLabel")}</th>
                  <th className="px-3 py-2 font-medium">{t("recruitment.control.staffEmailLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.index} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.index + 1}</td>
                    <td className="px-3 py-1.5">
                      <Badge className={`font-normal ${OUTCOME_TONE[r.outcome] ?? ""}`}>
                        {t(OUTCOME_LABEL[r.outcome] as "common.save")}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5">{r.fullName ?? ", "}</td>
                    <td className="px-3 py-1.5 text-xs">
                      <span className="block truncate">{r.email ?? ", "}</span>
                      {r.protectedFields.length > 0 && (
                        <span className="block text-muted-foreground">
                          {t("recruitment.responses.protectedNote", {
                            fields: r.protectedFields.join(", "),
                          })}
                        </span>
                      )}
                      {r.errors.length > 0 && (
                        <span className="block text-muted-foreground">{r.errors.join(" ")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canApply && (
            <Button disabled={pending} onClick={() => activeId && doApply(activeId)}>
              {pending ? t("recruitment.responses.applying") : t("recruitment.responses.apply")}
            </Button>
          )}
        </section>
      )}

      {/* ---- Source configuration (admin only) ---- */}
      {canConfigure && (
        <section className="space-y-3">
          <h2 className="section-label">
            {t("recruitment.responses.addSource")}
          </h2>
          <Card className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="src-label">{t("recruitment.responses.labelLabel")}</Label>
                <Input
                  id="src-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={t("recruitment.responses.labelPlaceholder")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="src-url">{t("recruitment.responses.sheetUrlLabel")}</Label>
                <Input
                  id="src-url"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder={t("recruitment.responses.sheetUrlPlaceholder")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("recruitment.responses.mappingTitle")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("recruitment.responses.mappingHelp")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {CANDIDATE_IMPORT_FIELDS.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={`map-${f.key}`} className="text-xs">
                      {f.label}
                      {f.required && " *"}
                    </Label>
                    <Input
                      id={`map-${f.key}`}
                      value={mapping[f.key] ?? ""}
                      onChange={(e) =>
                        setMapping((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                      // Headings come straight from the sheet, so a free-text field
                      // is more forgiving than a select built from a stale fetch.
                      placeholder={active?.mapping[f.key] ?? t("recruitment.responses.mappingUnmapped")}
                    />
                  </div>
                ))}
              </div>
            </div>

            <Button
              disabled={pending || !label.trim() || !sheetUrl.trim() || !mapping.fullName || !mapping.email}
              onClick={doSaveSource}
            >
              {t("recruitment.responses.save")}
            </Button>
          </Card>
        </section>
      )}
    </div>
  )
}
