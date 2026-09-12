"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { t } from "@/content/strings"
import { CYCLE_TRANSITIONS, type CycleStateName } from "@/lib/recruitment/permissions"
import { transitionCycle } from "../actions"

// Open, pause, finalise, complete, archive and cancel are all one guarded
// transition. `options` comes from CYCLE_TRANSITIONS on the server, so the buttons
// can only ever offer moves the state machine permits.
//
// The badge and the buttons move the moment the server says yes, rather than
// waiting for router.refresh() to come back. On a box in Sydney that refresh is
// a second or more, during which the old state was still on screen and the
// whole thing looked broken or ignored. The same table the server used decides
// what is offered next, so an optimistic state can never offer an illegal move.
export function CycleStateControls({
  cycleId,
  state,
  version,
  options,
  disabled,
}: {
  cycleId: string
  state: CycleStateName
  version: number
  options: readonly CycleStateName[]
  disabled: boolean
}) {
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()
  const [shown, setShown] = useState<CycleStateName>(state)
  const [moving, setMoving] = useState<CycleStateName | null>(null)

  // The server render is the truth: once the refresh lands, defer to it.
  useEffect(() => setShown(state), [state])

  const shownOptions = shown === state ? options : (CYCLE_TRANSITIONS[shown] ?? [])

  function move(to: CycleStateName) {
    setMoving(to)
    startTransition(async () => {
      const result = await transitionCycle({
        cycleId,
        to,
        reason: reason.trim() || undefined,
        // Optimistic lock: if someone else already moved the cycle, this is refused
        // rather than silently overwriting their change.
        expectedVersion: version,
      })
      if (!result.ok) {
        setMoving(null)
        toast.error(result.error)
        return
      }
      setShown(to)
      setMoving(null)
      toast.success(to)
      setReason("")
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <Badge className="bg-secondary font-normal text-secondary-foreground">{moving ?? shown}</Badge>

      {shownOptions.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("recruitment.audit.empty")}</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="transition-reason" className="text-xs">
              {t("recruitment.control.transitionReasonLabel")}
            </Label>
            <Input
              id="transition-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={disabled || pending}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {shownOptions.map((to) => (
              <Button
                key={to}
                size="sm"
                variant={to === "CANCELLED" ? "ghost" : "outline"}
                disabled={disabled || pending}
                onClick={() => move(to)}
              >
                {moving === to ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("recruitment.control.transitionTo")} {to}
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
