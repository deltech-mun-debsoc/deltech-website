"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CalendarPlus, CircleStop } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { closeCurrentEvent, startNewEvent } from "../actions"

const STATE_LABEL: Record<string, string> = {
  DRAFT: "Draft · not published yet",
  OPEN: "Registration open",
  ALLOTMENT: "Allotting",
  LIVE: "Live",
}

// Which event the platform is running, and the two deliberate ways to change
// that. Everything else on this page configures the current event; this card is
// the only place that ends one or begins the next.
export function EventLifecycle({
  current,
  canManage,
}: {
  current: { name: string; state: string } | null
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [closing, setClosing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [newName, setNewName] = useState("")

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
      const result = await startNewEvent({ name: newName })
      if (!result.success) {
        toast.error(result.error ?? "Could not start the new event.")
        return
      }
      setStarting(false)
      toast.success(`Started ${newName.trim()}. Build its committees, then publish it below.`)
      setNewName("")
      router.refresh()
    })

  return (
    <section className="space-y-5 border-y border-border py-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Events</p>
          <h2 className="mt-2 font-heading text-2xl">
            {current ? current.name : "No event is running"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {current
              ? STATE_LABEL[current.state] ?? current.state
              : "The site is in its society resting state. Start an event to take registrations."}
          </p>
        </div>
        {canManage && current && (
          <Button variant="outline" onClick={() => setClosing(true)} disabled={pending}>
            <CircleStop /> Close this event
          </Button>
        )}
      </div>

      {canManage ? (
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="new-event-name">Start a new event</Label>
            <Input
              id="new-event-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={"e.g. Intra MUN 2026"}
              className="h-11"
            />
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
        description={`${current?.name ?? "The event"} stops taking registrations and allotments. Its delegates, allotments and payments are kept, and it can still be looked up afterwards.`}
        confirmLabel={"Close event"}
        destructive
        pending={pending}
        onConfirm={close}
      />

      <ConfirmDialog
        open={starting}
        onOpenChange={(next) => !pending && setStarting(next)}
        title={"Start a new event?"}
        description={
          current
            ? `${current.name} will be closed first. ${newName.trim()} starts empty, with no committees, portfolios or delegates, and stays unpublished until you publish it below.`
            : `${newName.trim()} starts empty, with no committees, portfolios or delegates, and stays unpublished until you publish it below.`
        }
        confirmLabel={"Start event"}
        pending={pending}
        onConfirm={start}
      />
    </section>
  )
}
