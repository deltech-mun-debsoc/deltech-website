"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CalendarPlus, CircleStop } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"
import { closeCurrentEvent, startNewEvent } from "../actions"

const KINDS = [
  { value: "INTRA_MUN", label: "Intra MUN" },
  { value: "CONFERENCE", label: "Conference" },
] as const

// Ending the running event and beginning the next. Everything else on this page
// configures the event that is running.
export function EventLifecycle({
  current,
  canManage,
}: {
  current: { name: string } | null
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [closing, setClosing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [newName, setNewName] = useState("")
  const [kind, setKind] = useState<"INTRA_MUN" | "CONFERENCE">("INTRA_MUN")

  const close = () =>
    startTransition(async () => {
      const result = await closeCurrentEvent()
      if (!result.success) {
        toast.error(result.error ?? "Could not close the event.")
        return
      }
      setClosing(false)
      toast.success(`Closed ${current?.name}. Its delegates and allotments are kept.`)
      router.refresh()
    })

  const start = () =>
    startTransition(async () => {
      const result = await startNewEvent({ name: newName, kind })
      if (!result.success) {
        toast.error(result.error ?? "Could not start the new event.")
        return
      }
      setStarting(false)
      toast.success(`Started ${newName.trim()}. Add its details and committees, then publish it.`)
      setNewName("")
      router.refresh()
    })

  return (
    <section className={cn("space-y-5", current ? "border-t border-border pt-8" : "editorial-card p-6 sm:p-8")}>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">{current ? "Start or close" : "No event is running"}</p>
          <h2 className="mt-2 font-heading text-2xl">{current ? "Another event" : "Start an event"}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {current
              ? `Starting a new event closes ${current.name}. Nothing is deleted: its delegates and allotments stay, and it can be looked up later.`
              : "An event starts hidden and empty. Add its details, committees and seats, then publish it when it is ready."}
          </p>
        </div>
        {canManage && current && (
          <Button variant="outline" onClick={() => setClosing(true)} disabled={pending}>
            <CircleStop /> Close {current.name}
          </Button>
        )}
      </div>

      {canManage ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="new-event-name">Event name</Label>
            <Input
              id="new-event-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={kind === "INTRA_MUN" ? "DTU Intra MUN 2026" : "DelTech MUN 2027"}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Kind</p>
            <div className="flex h-11 overflow-hidden rounded-md border border-border" role="radiogroup" aria-label="Kind of event">
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
          <Button onClick={() => setStarting(true)} disabled={pending || !newName.trim()} className="h-11">
            <CalendarPlus /> Start event
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only an admin can close an event or start a new one.</p>
      )}

      <ConfirmDialog
        open={closing}
        onOpenChange={(next) => !pending && setClosing(next)}
        title={"Close this event?"}
        description={`${current?.name ?? "The event"} stops taking registrations and allotments and leaves the website. Its delegates, allotments and payments are kept.`}
        confirmLabel={"Close event"}
        destructive
        pending={pending}
        onConfirm={close}
      />

      <ConfirmDialog
        open={starting}
        onOpenChange={(next) => !pending && setStarting(next)}
        title={"Start a new event?"}
        description={`${current ? `${current.name} will be closed first. ` : ""}${newName.trim()} starts empty and hidden, with no committees, seats or delegates.`}
        confirmLabel={"Start event"}
        pending={pending}
        onConfirm={start}
      />
    </section>
  )
}
