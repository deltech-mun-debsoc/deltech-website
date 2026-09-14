"use client"

import { useState, useTransition } from "react"
import { CheckCircle2, XCircle, Users, Kanban } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import type { ValidatedRow } from "@/lib/schemas/import"
import type { CommitResult } from "../actions"
import { commitImport } from "../actions"

interface Props {
  validated: ValidatedRow[]
  skipped:   Set<number>
  onBack:    () => void
  onDone:    (result: CommitResult) => void
}

export function StepCommit({ validated, skipped, onBack, onDone }: Props) {
  const [result,  setResult]   = useState<CommitResult | null>(null)
  const [pending, startCommit] = useTransition()

  const importRows    = validated.filter((r) => !skipped.has(r.index) && r.errors.length === 0)
  const withAllotment = importRows.filter((r) => r.mapped.committee && r.mapped.portfolio).length

  const handleCommit = () => {
    startCommit(async () => {
      const res = await commitImport({
        rows:        importRows.map((r) => r.mapped),
        skippedRows: [],
      })
      setResult(res)
      if (res.created > 0) {
        toast.success(`Imported ${res.created} delegate${res.created !== 1 ? "s" : ""}${res.allotted > 0 ? `, ${res.allotted} allotted` : ""}.`)
      } else {
        toast.error("No delegates were created.")
      }
    })
  }

  if (result) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 space-y-6">
        <p className="text-base font-semibold text-foreground">Import results</p>

        <div className="grid grid-cols-4 gap-4">
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-center dark:bg-green-950/30 dark:border-green-800">
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">{result.created}</p>
            <p className="text-xs text-green-600 dark:text-green-500 mt-1">Imported</p>
          </div>
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 text-center">
            <p className="text-2xl font-bold text-primary">{result.allotted}</p>
            <p className="text-xs text-primary/70 mt-1">Auto-allotted</p>
          </div>
          <div className="rounded-lg bg-muted border border-border p-4 text-center">
            <p className="text-2xl font-bold text-muted-foreground">{result.skipped}</p>
            <p className="text-xs text-muted-foreground mt-1">Skipped (duplicate)</p>
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-center dark:bg-amber-950/30 dark:border-amber-800">
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{result.quarantined}</p>
            <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">Quarantined</p>
          </div>
        </div>

        {result.errors.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-destructive">Errors</p>
            <div className="overflow-auto max-h-48 rounded-lg border border-destructive/30 bg-destructive/5">
              {result.errors.map((e, i) => (
                <div key={i} className="flex gap-3 px-4 py-2 border-b border-destructive/10 last:border-0">
                  <XCircle className="size-4 shrink-0 text-destructive mt-0.5" />
                  <div>
                    <span className="text-xs font-medium text-foreground">{e.email}</span>
                    <span className="text-xs text-muted-foreground"> · {e.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button className="w-full" onClick={() => result && onDone(result)}>Done</Button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-6">
      {/* Summary */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ready to import</p>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2 text-sm">
            <Users className="size-4 text-primary" />
            <span className="font-medium">{importRows.length}</span>
            <span className="text-muted-foreground">delegates</span>
          </div>
          {withAllotment > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <Kanban className="size-4 text-primary" />
              <span className="font-medium">{withAllotment}</span>
              <span className="text-muted-foreground">will be auto-allotted (best available preference)</span>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-green-600" />
            <p className="text-sm font-medium text-foreground">All delegates will be marked Confirmed</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground pl-6">
            Cross-delegation imports are always confirmed immediately, no payment requests sent.
          </p>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack} disabled={pending}>← Back</Button>
        <Button onClick={handleCommit} disabled={pending || importRows.length === 0}>
          {pending ? "Importing…" : `Import ${importRows.length} delegates`}
        </Button>
      </div>
    </div>
  )
}
