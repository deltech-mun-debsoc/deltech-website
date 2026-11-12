"use client"

import { useState, useTransition } from "react"
import { XCircle } from "lucide-react"
import Link from "next/link"
import { Button, buttonVariants } from "@/components/ui/button"
import { toast } from "sonner"
import { unresolvedCommittees, type ValidatedRow } from "@/lib/schemas/import"
import type { CommitResult } from "../actions"
import { commitImport } from "../actions"

interface Props {
  validated:      ValidatedRow[]
  skipped:        Set<number>
  committeeNames: string[]
  onBack:         () => void
}

// Ends on what to do next, not on "Import complete": the organiser should not
// have to go back into the wizard to find out what is left.
export function StepCommit({ validated, skipped, committeeNames, onBack }: Props) {
  const [result,  setResult]   = useState<CommitResult | null>(null)
  const [pending, startCommit] = useTransition()

  const importRows = validated.filter(
    (r) => !skipped.has(r.index) && r.errors.length === 0 && unresolvedCommittees(r.mapped, committeeNames).length === 0,
  )

  const handleCommit = () => {
    startCommit(async () => {
      const res = await commitImport({ rows: importRows.map((r) => r.mapped), skippedRows: [] })
      setResult(res)
      if (res.created === 0) toast.error("No delegates were created.")
    })
  }

  if (result) {
    const needSeat = result.created - result.allotted
    return (
      <div className="editorial-card space-y-6 p-8">
        <div className="space-y-1">
          <p className="font-heading text-xl">{`${result.created} accepted`}</p>
          <p className="text-sm text-muted-foreground">
            {[
              result.allotted > 0 && `${result.allotted} got a draft seat from their choices`,
              needSeat > 0 && `${needSeat} need a seat`,
              result.skipped > 0 && `${result.skipped} were already registered`,
              result.quarantined > 0 && `${result.quarantined} need fixing`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        {result.errors.length > 0 && (
          <div className="max-h-48 overflow-auto rounded-lg border border-border">
            {result.errors.map((e, i) => (
              <div key={i} className="flex gap-3 border-b border-border/60 px-4 py-2 last:border-0">
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="text-xs">
                  <span className="font-medium">{e.email}</span>
                  <span className="text-muted-foreground">{` · ${e.reason}`}</span>
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {result.quarantined > 0 && (
            <Link href="/admin/import#quarantine" className={buttonVariants({ variant: "outline" })}>
              Review exceptions
            </Link>
          )}
          <Link href="/admin/registrations?source=CROSS_DEL" className={buttonVariants({ variant: "outline" })}>
            View imported delegates
          </Link>
          {(needSeat > 0 || result.allotted > 0) && (
            <Link href="/admin/allotment" className={buttonVariants()}>
              {needSeat > 0 ? "Assign remaining seats" : "Email the draft seats"}
            </Link>
          )}
        </div>
      </div>
    )
  }

  const withChoice = importRows.filter((r) => r.mapped.committee && r.mapped.portfolio).length
  return (
    <div className="editorial-card space-y-6 p-6">
      <div className="space-y-2 text-sm">
        <p className="font-medium">{`${importRows.length} delegates will be accepted, with nothing to pay.`}</p>
        <p className="text-muted-foreground">
          {withChoice > 0
            ? `Anyone whose first free choice is open gets it as a draft seat (${withChoice} gave a choice); nobody is emailed. The rest wait as "Accepted, needs a seat".`
            : `They wait as "Accepted, needs a seat" until you give them one on Allotment. Nobody is emailed.`}
        </p>
      </div>
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack} disabled={pending}>Back</Button>
        <Button onClick={handleCommit} disabled={pending || importRows.length === 0}>
          {pending ? "Importing…" : `Import ${importRows.length} delegates`}
        </Button>
      </div>
    </div>
  )
}
