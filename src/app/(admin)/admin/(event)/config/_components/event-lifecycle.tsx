"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CalendarPlus, ChevronDown, CircleStop, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatDate } from "@/lib/datetime"
import { cn } from "@/lib/utils"
import { closeCurrentEvent, reopenPastEvent, startNewEvent } from "../actions"

const KINDS = [
  { value: "INTRA_MUN", label: "Intra MUN" },
  { value: "CONFERENCE", label: "Conference" },
] as const

type PastEvent = { id: string; name: string; kind: string; closedAt: string | null; delegates: number }

// Ending the running event, beginning the next, and bringing a past one back.
export function EventLifecycle({
  current,
  past,
  canManage,
}: {
  current: { name: string } | null
  past: PastEvent[]
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [closing, setClosing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [reopening, setReopening] = useState<PastEvent | null>(null)
  const [newName, setNewName] = useState("")
  const [kind, setKind] = useState<"INTRA_MUN" | "CONFERENCE">("INTRA_MUN")

  const run = (fn: () => Promise<{ success: boolean; error?: string }>, ok: string, done: () => void) =>
    startTransition(async () => {
      const result = await fn()
      if (!result.success) {
        toast.error(result.error ?? "Something went wrong.")
        return
      }
      done()
      toast.success(ok)
      router.refresh()
    })

  return (
    <section className={cn("space-y-8", current ? "border-t border-border pt-10" : "editorial-card p-6 sm:p-8")}>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">{current ? "Events" : "No event is running"}</p>
          <h2 className="mt-2 font-heading text-2xl">{current ? "Start, close or reopen" : "Start or reopen an event"}</h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Nothing is ever deleted. A closed event keeps its delegates and seats, and can be reopened.
          </p>
        </div>
        {canManage && current && (
          <Button variant="outline" onClick={() => setClosing(true)} disabled={pending}>
            <CircleStop /> Close {current.name}
          </Button>
        )}
      </div>

      {!canManage ? (
        <p className="text-sm text-muted-foreground">Only an admin can start, close or reopen events.</p>
      ) : (
        <form
          className="flex flex-col gap-4 rounded-xl border border-border/70 p-5 lg:flex-row lg:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            setStarting(true)
          }}
        >
          <div className="flex-1 space-y-2">
            <Label htmlFor="new-event-name">New event name</Label>
            <Input
              id="new-event-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={kind === "INTRA_MUN" ? "DTU Intra MUN 2026" : "DelTech MUN 2027"}
              required
            />
          </div>
          <div className="space-y-2">
            <p className="text-[0.9375rem] font-semibold">Kind</p>
            <div className="flex h-11 overflow-hidden rounded-lg border border-input" role="radiogroup" aria-label="Kind of event">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.value}
                  onClick={() => setKind(k.value)}
                  className={cn("px-4 text-sm transition-colors", kind === k.value ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          <Button type="submit" size="lg" disabled={pending || !newName.trim()}>
            <CalendarPlus /> Start event
          </Button>
        </form>
      )}

      {past.length > 0 && (
        <details open={!current} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            {`Past events (${past.length})`}
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-4 divide-y divide-border/60 rounded-xl border border-border/70">
            {past.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{e.name}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {`${e.kind === "INTRA_MUN" ? "Intra MUN" : "Conference"} · ${e.delegates} delegates${e.closedAt ? ` · closed ${formatDate(e.closedAt)}` : ""}`}
                  </p>
                </div>
                {canManage && (
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => setReopening(e)}>
                    <RotateCcw className="size-4" /> Reopen
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ConfirmDialog
        open={closing}
        onOpenChange={(next) => !pending && setClosing(next)}
        title="Close this event?"
        description={`${current?.name ?? "The event"} stops taking registrations and allotments and leaves the website. Its delegates, seats and payments are kept, and you can reopen it later.`}
        confirmLabel="Close event"
        destructive
        pending={pending}
        onConfirm={() => run(closeCurrentEvent, `Closed ${current?.name}.`, () => setClosing(false))}
      />

      <ConfirmDialog
        open={starting}
        onOpenChange={(next) => !pending && setStarting(next)}
        title="Start a new event?"
        description={`${current ? `${current.name} will be closed first. ` : ""}${newName.trim()} starts empty and hidden, with no committees, seats or delegates.`}
        confirmLabel="Start event"
        pending={pending}
        onConfirm={() =>
          run(
            () => startNewEvent({ name: newName, kind }),
            `Started ${newName.trim()}. Add its details and committees, then publish it.`,
            () => {
              setStarting(false)
              setNewName("")
            },
          )
        }
      />

      <ConfirmDialog
        open={!!reopening}
        onOpenChange={(next) => !pending && !next && setReopening(null)}
        title={`Reopen ${reopening?.name ?? "this event"}?`}
        description={`${current ? `${current.name} will be closed first. ` : ""}It comes back hidden with registration off, with its delegates and seats as they were. Check its dates and venue before publishing: those are not saved per event.`}
        confirmLabel="Reopen event"
        pending={pending}
        onConfirm={() =>
          reopening && run(() => reopenPastEvent({ id: reopening.id }), `Reopened ${reopening.name}. Publish it when it is ready.`, () => setReopening(null))
        }
      />
    </section>
  )
}
