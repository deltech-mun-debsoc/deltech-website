"use client"

import { formatDateTime } from "@/lib/datetime"
import { useMemo, useState, useTransition } from "react"
import { ChevronRight, RotateCcw, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { readAuditChange, readSettingsRollback } from "@/lib/audit-change"
import { rollbackAuditLog } from "../actions"

export interface SerializedAuditLog {
  id: string
  actorEmail: string
  action: string
  entity: string
  entityId: string | null
  meta: unknown
  at: string
  rolledBack: boolean
}

function valueLabel(value: unknown): string {
  if (value === null) return "Not set"
  if (typeof value === "boolean") return value ? "On" : "Off"
  if (Array.isArray(value)) return value.join(", ")
  if (typeof value === "object") return JSON.stringify(value, null, 2)
  return String(value)
}

function actionLabel(action: string): string {
  return action
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function LogsClient({
  logs,
  canRollback,
}: {
  logs: SerializedAuditLog[]
  canRollback: boolean
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<SerializedAuditLog | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [isPending, startTransition] = useTransition()
  const rollback = useMemo(() => readSettingsRollback(selected?.meta), [selected])
  const change = useMemo(() => readAuditChange(selected?.meta), [selected])

  const runRollback = () => {
    if (!selected) return
    startTransition(async () => {
      const result = await rollbackAuditLog(selected.id)
      if (!result.success) {
        toast.error(result.error ?? "Rollback failed.")
        return
      }
      toast.success("Change rolled back.")
      setConfirming(false)
      setSelected(null)
      router.refresh()
    })
  }

  return (
    <>
      <div className="editorial-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3 text-right">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr
                key={log.id}
                className="cursor-pointer border-b border-border/60 outline-none last:border-0 hover:bg-accent/40 focus-visible:bg-accent/50"
                tabIndex={0}
                onClick={() => setSelected(log)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    setSelected(log)
                  }
                }}
              >
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                  {formatDateTime(log.at)}
                </td>
                <td className="max-w-44 truncate px-4 py-3 text-xs">{log.actorEmail}</td>
                <td className="px-4 py-3">
                  <Badge
                    variant={/delete|cancel|revoke|reject/.test(log.action) ? "destructive" : "secondary"}
                    className="font-mono text-xs"
                  >
                    {log.action}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {log.entity}
                  {log.entityId && <span className="opacity-60"> · {log.entityId.slice(0, 8)}</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="ml-auto flex w-fit items-center gap-1 text-xs font-semibold text-primary">
                    Open <ChevronRight className="size-3.5" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Drawer
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(false)
            setSelected(null)
          }
        }}
        direction="right"
      >
        <DrawerContent className="flex overflow-hidden sm:max-w-xl">
          <DrawerHeader className="flex-row items-start justify-between border-b border-border">
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Activity detail</p>
              <DrawerTitle className="mt-2 text-2xl">
                {selected ? actionLabel(selected.action) : "Activity"}
              </DrawerTitle>
            </div>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon"><X className="size-4" /></Button>
            </DrawerClose>
          </DrawerHeader>

          {selected && (
            <div className="flex-1 space-y-7 overflow-y-auto p-5">
              <dl className="grid grid-cols-2 gap-5 border-b border-border pb-6 text-sm">
                <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Actor</dt><dd className="mt-1 font-medium">{selected.actorEmail}</dd></div>
                <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Time</dt><dd className="mt-1 font-medium">{formatDateTime(selected.at)}</dd></div>
                <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Entity</dt><dd className="mt-1 font-medium">{selected.entity}</dd></div>
                <div><dt className="text-xs uppercase tracking-wider text-muted-foreground">Record</dt><dd className="mt-1 break-all font-mono text-xs">{selected.entityId ?? "Multiple records"}</dd></div>
              </dl>

              {change ? (
                <section>
                  <h3 className="font-heading text-xl">What changed</h3>
                  <div className="mt-4 divide-y divide-border border-y border-border">
                    {Object.keys(change.after).map((key) => (
                      <div key={key} className="grid gap-3 py-4 sm:grid-cols-[9rem_1fr]">
                        <p className="font-mono text-xs font-semibold">{key}</p>
                        <div className="grid gap-2 text-xs">
                          <p><span className="text-muted-foreground">Before:</span> <span className="whitespace-pre-wrap">{valueLabel(change.before[key])}</span></p>
                          <p><span className="text-muted-foreground">After:</span> <span className="whitespace-pre-wrap">{valueLabel(change.after[key])}</span></p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
                <section>
                  <h3 className="font-heading text-xl">Recorded details</h3>
                  <pre className="mt-4 overflow-x-auto whitespace-pre-wrap border border-border bg-muted/40 p-4 text-xs leading-relaxed">
                    {selected.meta ? JSON.stringify(selected.meta, null, 2) : "No additional details were recorded."}
                  </pre>
                </section>
              )}

              <section className="border-t border-border pt-5">
                {selected.rolledBack ? (
                  <p className="text-sm text-muted-foreground">This change has already been rolled back.</p>
                ) : rollback && canRollback ? (
                  <div className="flex items-center justify-between gap-4">
                    <p className="max-w-sm text-sm text-muted-foreground">
                      Rollback is available only while these values still match this entry.
                    </p>
                    <Button variant="destructive" onClick={() => setConfirming(true)}>
                      <RotateCcw className="size-4" /> Roll back
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {rollback
                      ? "Only admins can roll back changes."
                      : "This action has external or destructive effects, so it is view-only."}
                  </p>
                )}
              </section>
            </div>
          )}
        </DrawerContent>
      </Drawer>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Roll back this change?</DialogTitle>
            <DialogDescription>
              The previous values will be restored only if nobody has changed them since. This creates a new audit entry.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Keep current state</DialogClose>
            <Button variant="destructive" onClick={runRollback} disabled={isPending}>
              {isPending ? "Rolling back…" : "Confirm rollback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
