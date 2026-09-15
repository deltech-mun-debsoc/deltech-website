"use client"

import { useState, useRef } from "react"
import { CheckCircle2, XCircle, AlertCircle, Pencil, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import type { ValidatedRow, MappedRow } from "@/lib/schemas/import"
import { mappedRowSchema } from "@/lib/schemas/import"

// ── Editable cell ────────────────────────────────────────────────────────────

interface EditableCellProps {
  value:       string | undefined
  onSave:      (val: string) => void
  placeholder?: string
  className?:   string
}

function EditableCell({ value, onSave, placeholder = "-", className = "" }: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value ?? "")
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = () => {
    setEditing(false)
    onSave(draft.trim())
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        className={`w-full min-w-[80px] rounded border border-primary bg-primary/5 px-1.5 py-0.5 text-xs outline-none ${className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false) }
        }}
      />
    )
  }

  return (
    <button
      className={`group flex w-full items-center gap-1 text-left text-xs ${className}`}
      onClick={() => { setDraft(value ?? ""); setEditing(true) }}
      title="Click to edit"
    >
      <span className={value ? "text-foreground" : "text-muted-foreground"}>
        {value || placeholder}
      </span>
      <Pencil className="size-2.5 shrink-0 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  )
}

// ── Deletable column header ──────────────────────────────────────────────────

function ColHeader({
  label,
  onDelete,
}: {
  label:    string
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-1 group">
      <span>{label}</span>
      <button
        onClick={onDelete}
        title={`Remove ${label} column`}
        className="ml-0.5 rounded p-px text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

// ── Column groups that can be deleted ────────────────────────────────────────

type ColGroup = "whatsapp" | "institution" | "pref1" | "pref2" | "pref3" | "note"

const COL_GROUP_FIELDS: Record<ColGroup, (keyof MappedRow)[]> = {
  whatsapp:    ["whatsapp"],
  institution: ["institution"],
  pref1:       ["committee", "portfolio"],
  pref2:       ["committee2", "portfolio2"],
  pref3:       ["committee3", "portfolio3"],
  note:        ["note"],
}

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  validated:      ValidatedRow[]
  skipped:        Set<number>
  committeeNames: string[]
  onSkipChange:   (s: Set<number>) => void
  onRowUpdate:    (index: number, field: keyof MappedRow, value: string) => void
  onBack:         () => void
  onNext:         () => void
}

// ── Component ────────────────────────────────────────────────────────────────

export function StepPreview({
  validated,
  skipped,
  onSkipChange,
  onRowUpdate,
  onBack,
  onNext,
}: Props) {
  const [hidden, setHidden] = useState<Set<ColGroup>>(new Set())

  const toggleSkip = (index: number) => {
    const next = new Set(skipped)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    onSkipChange(next)
  }

  // Clear all rows for a column group and hide it
  const deleteColumn = (group: ColGroup) => {
    const fields = COL_GROUP_FIELDS[group]
    validated.forEach((row) => {
      fields.forEach((field) => onRowUpdate(row.index, field, ""))
    })
    setHidden((prev) => new Set([...prev, group]))
  }

  const show = (group: ColGroup) => !hidden.has(group)

  const validCount   = validated.filter((r) => {
    const errors = revalidateErrors(r)
    return errors.length === 0 && !skipped.has(r.index)
  }).length
  const errorCount   = validated.filter((r) => {
    const errors = revalidateErrors(r)
    return errors.length > 0 && !skipped.has(r.index)
  }).length
  const skippedCount = skipped.size
  const canProceed   = validCount > 0

  function revalidateErrors(row: ValidatedRow): string[] {
    const parse = mappedRowSchema.safeParse(row.mapped)
    return parse.success ? [] : parse.error.issues.map((e) => e.message)
  }

  const hiddenCount = hidden.size

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card px-5 py-3">
        <div className="flex items-center gap-1.5 text-sm">
          <CheckCircle2 className="size-4 text-green-600" />
          <span className="font-medium text-foreground">{validCount}</span>
          <span className="text-muted-foreground">valid</span>
        </div>
        {errorCount > 0 && (
          <div className="flex items-center gap-1.5 text-sm">
            <XCircle className="size-4 text-destructive" />
            <span className="font-medium text-foreground">{errorCount}</span>
            <span className="text-muted-foreground">with errors</span>
          </div>
        )}
        {skippedCount > 0 && (
          <div className="flex items-center gap-1.5 text-sm">
            <AlertCircle className="size-4 text-muted-foreground" />
            <span className="font-medium text-foreground">{skippedCount}</span>
            <span className="text-muted-foreground">skipped</span>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Click any cell to edit · hover column header to delete it</p>
        <div className="ml-auto flex flex-wrap gap-2">
          {hiddenCount > 0 && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              onClick={() => setHidden(new Set())}
            >
              Restore {hiddenCount} hidden column{hiddenCount !== 1 ? "s" : ""}
            </button>
          )}
          <button
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            onClick={() => {
              const errorIndices = new Set(
                validated.filter((r) => revalidateErrors(r).length > 0).map((r) => r.index),
              )
              onSkipChange(errorIndices)
            }}
          >
            Skip all errors
          </button>
          <button
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            onClick={() => onSkipChange(new Set())}
          >
            Unskip all
          </button>
        </div>
      </div>

      {/* Preview table */}
      <div className="overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="w-10 py-2 pl-3"><span className="sr-only">Skip</span></th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">#</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Full name</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Email</th>
              {show("whatsapp") && (
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  <ColHeader label="Phone" onDelete={() => deleteColumn("whatsapp")} />
                </th>
              )}
              {show("institution") && (
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  <ColHeader label="Institution" onDelete={() => deleteColumn("institution")} />
                </th>
              )}
              {show("pref1") && (
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  <ColHeader label="Pref 1" onDelete={() => deleteColumn("pref1")} />
                </th>
              )}
              {show("pref2") && (
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  <ColHeader label="Pref 2" onDelete={() => deleteColumn("pref2")} />
                </th>
              )}
              {show("pref3") && (
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  <ColHeader label="Pref 3" onDelete={() => deleteColumn("pref3")} />
                </th>
              )}
              {show("note") && (
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  <ColHeader label="Note" onDelete={() => deleteColumn("note")} />
                </th>
              )}
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {validated.map((row) => {
              const isSkipped = skipped.has(row.index)
              const errors    = revalidateErrors(row)
              const hasErrors = errors.length > 0
              return (
                <tr
                  key={row.index}
                  className={isSkipped ? "opacity-40" : hasErrors ? "bg-destructive/5" : ""}
                >
                  <td className="py-2 pl-3">
                    <Checkbox
                      checked={isSkipped}
                      onCheckedChange={() => toggleSkip(row.index)}
                      title={isSkipped ? "Unskip row" : "Skip row"}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{row.index + 1}</td>

                  {/* Full name, not deletable */}
                  <td className="px-3 py-2 min-w-[120px]">
                    <div className="flex items-center gap-1">
                      <EditableCell
                        value={row.mapped.fullName}
                        onSave={(v) => onRowUpdate(row.index, "fullName", v)}
                      />
                      {row.aiNote && (
                        <span
                          title={`AI: ${row.aiNote}`}
                          className="shrink-0 cursor-help rounded px-1 py-px text-[9px] font-semibold bg-primary/10 text-primary"
                        >
                          AI
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Email, not deletable */}
                  <td className="px-3 py-2 min-w-[140px]">
                    <EditableCell
                      value={row.mapped.email}
                      onSave={(v) => onRowUpdate(row.index, "email", v)}
                    />
                  </td>

                  {show("whatsapp") && (
                    <td className="px-3 py-2 min-w-[100px]">
                      <EditableCell
                        value={row.mapped.whatsapp}
                        onSave={(v) => onRowUpdate(row.index, "whatsapp", v)}
                      />
                    </td>
                  )}

                  {show("institution") && (
                    <td className="px-3 py-2 min-w-[120px]">
                      <EditableCell
                        value={row.mapped.institution}
                        onSave={(v) => onRowUpdate(row.index, "institution", v)}
                      />
                    </td>
                  )}

                  {show("pref1") && (
                    <td className="px-3 py-2 min-w-[140px]">
                      <div className="space-y-0.5">
                        <EditableCell
                          value={row.mapped.committee}
                          onSave={(v) => onRowUpdate(row.index, "committee", v)}
                        />
                        <EditableCell
                          value={row.mapped.portfolio}
                          onSave={(v) => onRowUpdate(row.index, "portfolio", v)}
                          className="text-muted-foreground"
                        />
                      </div>
                    </td>
                  )}

                  {show("pref2") && (
                    <td className="px-3 py-2 min-w-[140px]">
                      <div className="space-y-0.5">
                        <EditableCell
                          value={row.mapped.committee2}
                          onSave={(v) => onRowUpdate(row.index, "committee2", v)}
                        />
                        <EditableCell
                          value={row.mapped.portfolio2}
                          onSave={(v) => onRowUpdate(row.index, "portfolio2", v)}
                          className="text-muted-foreground"
                        />
                      </div>
                    </td>
                  )}

                  {show("pref3") && (
                    <td className="px-3 py-2 min-w-[140px]">
                      <div className="space-y-0.5">
                        <EditableCell
                          value={row.mapped.committee3}
                          onSave={(v) => onRowUpdate(row.index, "committee3", v)}
                        />
                        <EditableCell
                          value={row.mapped.portfolio3}
                          onSave={(v) => onRowUpdate(row.index, "portfolio3", v)}
                          className="text-muted-foreground"
                        />
                      </div>
                    </td>
                  )}

                  {show("note") && (
                    <td className="px-3 py-2 min-w-[100px]">
                      <EditableCell
                        value={row.mapped.note}
                        onSave={(v) => onRowUpdate(row.index, "note", v)}
                      />
                    </td>
                  )}

                  <td className="px-3 py-2">
                    {isSkipped ? (
                      <Badge variant="outline" className="text-[10px]">skip</Badge>
                    ) : hasErrors ? (
                      <div className="space-y-0.5">
                        {errors.map((e, i) => (
                          <p key={i} className="text-[10px] text-destructive">{e}</p>
                        ))}
                      </div>
                    ) : (
                      <CheckCircle2 className="size-4 text-green-600" />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onNext} disabled={!canProceed}>
          Import {validCount} delegates →
        </Button>
      </div>
    </div>
  )
}
