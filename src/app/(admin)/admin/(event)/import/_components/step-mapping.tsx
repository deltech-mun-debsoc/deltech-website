"use client"

import { useState, useTransition } from "react"
import { Save, Trash2, Sparkles, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import {
  IMPORT_FIELDS,
  mappedRowSchema,
  applyMapping,
  type ColumnMapping,
  type ValidatedRow,
} from "@/lib/schemas/import"

import type { ImportPresetRecord } from "../actions"
import { saveImportPreset, deleteImportPreset } from "../actions"
import { suggestMappingWithGemini, cleanImportRowsWithGemini } from "../actions-ai"

const NONE_SENTINEL = "__none__"

interface Props {
  headers:            string[]
  rawRows:            Record<string, string>[]
  mapping:            ColumnMapping
  presets:            ImportPresetRecord[]
  committeeNames:     string[]
  defaultInstitution: string
  onMappingChange:    (m: ColumnMapping) => void
  onPresetsChange:    (p: ImportPresetRecord[]) => void
  onBack:             () => void
  onNext:             (mapping: ColumnMapping, validated: ValidatedRow[]) => void
}

export function StepMapping({
  headers,
  rawRows,
  mapping,
  presets,
  committeeNames,
  defaultInstitution,
  onMappingChange,
  onPresetsChange,
  onBack,
  onNext,
}: Props) {
  const [presetName,    setPresetName]    = useState("")
  const [presetPartner, setPresetPartner] = useState("")
  const [saving,        startSave]        = useTransition()
  const [deleting,      startDelete]      = useTransition()
  const [aiSuggesting,  startAiSuggest]   = useTransition()
  const [proceeding,    startProceed]     = useTransition()

  const setField = (key: keyof ColumnMapping, col: string) => {
    onMappingChange({ ...mapping, [key]: col === NONE_SENTINEL ? undefined : col })
  }

  const requiredMapped = IMPORT_FIELDS
    .filter((f) => f.required)
    .every((f) => !!mapping[f.key])

  // ── Auto-map with AI ──────────────────────────────────────────────────────
  const handleAISuggest = () => {
    startAiSuggest(async () => {
      const result = await suggestMappingWithGemini(headers, rawRows.slice(0, 5))
      if (!result.success || !result.mapping) {
        toast.error(result.error ?? "AI mapping failed.")
        return
      }
      onMappingChange(result.mapping)
      const count = Object.values(result.mapping).filter(Boolean).length
      toast.success(`AI mapped ${count} column${count !== 1 ? "s" : ""}.`)
    })
  }

  // ── Preview, always normalises with AI ──────────────────────────────────
  const handleNext = () => {
    startProceed(async () => {
      const prelimRows = rawRows.map((r) => applyMapping(r, mapping, defaultInstitution))

      const cleanResult = await cleanImportRowsWithGemini(prelimRows, committeeNames)

      let validated: ValidatedRow[]

      if (!cleanResult.success || !cleanResult.cleaned) {
        if (cleanResult.rateLimited) {
          toast.error("AI quota exceeded, please retry in a few minutes.")
          return
        }
        toast.warning(cleanResult.error ?? "AI normalisation failed, showing raw values.")
        validated = rawRows.map((r, i) => {
          const mapped = applyMapping(r, mapping, defaultInstitution)
          const parse  = mappedRowSchema.safeParse(mapped)
          const errors = parse.success ? [] : parse.error.issues.map((e) => e.message)
          return { index: i, raw: r, mapped, errors }
        })
      } else {
        validated = cleanResult.cleaned.map(({ _note, _skip, ...mapped }, i) => {
          const parse  = mappedRowSchema.safeParse(mapped)
          const errors = parse.success ? [] : parse.error.issues.map((e) => e.message)
          return { index: i, raw: rawRows[i], mapped, errors, aiNote: _note }
        })
        const noteCount = cleanResult.cleaned.filter((c) => c._note).length
        if (noteCount > 0) toast.info(`AI normalised ${noteCount} row${noteCount !== 1 ? "s" : ""}.`)
      }

      onNext(mapping, validated)
    })
  }

  // ── Presets ───────────────────────────────────────────────────────────────
  const handleLoadPreset = (id: string) => {
    const preset = presets.find((p) => p.id === id)
    if (preset) {
      onMappingChange(preset.mapping)
      setPresetName(preset.name)
      setPresetPartner(preset.partner ?? "")
      toast.success(`Loaded preset "${preset.name}"`)
    }
  }

  const handleSavePreset = () => {
    if (!presetName.trim()) { toast.error("Enter a preset name."); return }
    startSave(async () => {
      const result = await saveImportPreset(presetName.trim(), presetPartner.trim(), mapping)
      if (!result.success || !result.preset) { toast.error(result.error ?? "Save failed."); return }
      const saved = result.preset
      onPresetsChange([...presets.filter((p) => p.id !== saved.id), saved])
      toast.success(`Preset "${saved.name}" saved.`)
    })
  }

  const handleDeletePreset = (id: string, name: string) => {
    startDelete(async () => {
      await deleteImportPreset(id)
      onPresetsChange(presets.filter((p) => p.id !== id))
      toast.success(`Preset "${name}" deleted.`)
    })
  }

  const firstRow = rawRows[0]

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-6">
      {/* Presets */}
      {presets.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Saved presets
          </p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-1 rounded-md border border-border bg-muted/40 pl-3 pr-1 py-1"
              >
                <button
                  className="text-xs font-medium text-foreground hover:text-primary"
                  onClick={() => handleLoadPreset(p.id)}
                >
                  {p.name}
                  {p.partner && (
                    <span className="ml-1 text-muted-foreground">({p.partner})</span>
                  )}
                </button>
                <button
                  className="ml-1 rounded p-0.5 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeletePreset(p.id, p.name)}
                  disabled={deleting}
                  title="Delete preset"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
          <Separator />
        </div>
      )}

      {/* Column mapping */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Column mapping
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              AI will normalise data regardless of how the columns are labelled.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAISuggest}
            disabled={aiSuggesting || proceeding}
          >
            {aiSuggesting ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 size-3.5" />
            )}
            {aiSuggesting ? "Detecting…" : "Auto-detect columns"}
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="py-2 pl-4 pr-2 text-left text-xs font-medium text-muted-foreground">
                  Our field
                </th>
                <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                  Their column
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                  Preview (row 1)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {IMPORT_FIELDS.map((field) => {
                const selected   = mapping[field.key]
                const previewVal = selected && firstRow ? firstRow[selected] : null
                return (
                  <tr key={field.key} className="bg-card">
                    <td className="py-2.5 pl-4 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{field.label}</span>
                        {field.required && (
                          <Badge variant="secondary" className="text-[10px]">required</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        value={selected ?? NONE_SENTINEL}
                        onValueChange={(v) => { if (v !== null) setField(field.key, v) }}
                      >
                        <SelectTrigger className="h-8 w-48 text-xs">
                          <SelectValue placeholder=",  skip , " />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_SENTINEL} className="text-xs text-muted-foreground">
                           , skip.
                          </SelectItem>
                          {headers.map((h) => (
                            <SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-2">
                      {previewVal != null ? (
                        <span className="text-xs text-foreground">
                          {previewVal || <span className="text-muted-foreground">(empty)</span>}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Save as preset */}
      <div className="space-y-2 rounded-lg border border-dashed border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Save as preset
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="Preset name (e.g. NITI Aayog MUN)"
            className="h-8 text-xs"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
          />
          <Input
            placeholder="Partner (optional)"
            className="h-8 w-36 text-xs"
            value={presetPartner}
            onChange={(e) => setPresetPartner(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={handleSavePreset} disabled={saving}>
            <Save className="mr-1.5 size-3.5" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" onClick={onBack} disabled={proceeding}>← Back</Button>
        <Button onClick={handleNext} disabled={!requiredMapped || proceeding}>
          {proceeding ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Normalising…
            </>
          ) : (
            <>Preview {rawRows.length} rows →</>
          )}
        </Button>
      </div>
    </div>
  )
}
