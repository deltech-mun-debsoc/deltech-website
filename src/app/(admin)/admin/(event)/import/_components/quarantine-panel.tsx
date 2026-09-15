"use client"

import { formatDateTime } from "@/lib/datetime"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { retryQuarantined, dismissQuarantined, type QuarantineRecord } from "../actions"
import type { MappedRow } from "@/lib/schemas/import"

interface Props {
  rows: QuarantineRecord[]
}

// Rows any intake channel (wizard, Google Form webhook, cron sync) couldn't
// turn into a Delegate. Fix inline, retry, or dismiss, nothing is ever
// silently dropped upstream.
export function QuarantinePanel({ rows }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [edits, setEdits] = useState<Record<string, Partial<MappedRow>>>({})

  if (rows.length === 0) return null

  const edited = (r: QuarantineRecord): MappedRow => ({ ...r.raw, ...edits[r.id] })

  const setField = (id: string, field: keyof MappedRow, value: string) =>
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value || undefined } }))

  const retry = (r: QuarantineRecord) =>
    startTransition(async () => {
      const result = await retryQuarantined(r.id, edited(r))
      if (result.success) {
        toast.success("Row imported.")
        router.refresh()
      } else {
        toast.error(result.error ?? "Retry failed.")
      }
    })

  const dismiss = (id: string) =>
    startTransition(async () => {
      await dismissQuarantined(id)
      toast.success("Row dismissed.")
      router.refresh()
    })

  return (
    <div className="space-y-3 rounded-xl border border-amber-300/60 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold">Quarantine</p>
        <Badge variant="secondary" className="text-xs">{rows.length}</Badge>
        <p className="text-xs text-muted-foreground">
          Rows that failed validation, fix and retry, or dismiss.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-[10px]">{r.source}</Badge>
              <span>{formatDateTime(r.createdAt)}</span>
              <span className="text-destructive">{r.errors.join("; ")}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 w-44 text-xs"
                placeholder="Full name"
                defaultValue={r.raw.fullName ?? ""}
                onChange={(e) => setField(r.id, "fullName", e.target.value)}
              />
              <Input
                className="h-8 w-56 text-xs"
                placeholder="Email"
                defaultValue={r.raw.email ?? ""}
                onChange={(e) => setField(r.id, "email", e.target.value)}
              />
              <Input
                className="h-8 w-36 text-xs"
                placeholder="Phone"
                defaultValue={r.raw.whatsapp ?? ""}
                onChange={(e) => setField(r.id, "whatsapp", e.target.value)}
              />
              <div className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 text-xs"
                  disabled={isPending}
                  onClick={() => retry(r)}
                >
                  <RotateCcw className="size-3" /> Retry
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1 text-xs text-muted-foreground"
                  disabled={isPending}
                  onClick={() => dismiss(r.id)}
                >
                  <X className="size-3" /> Dismiss
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
