"use client"

import { useState, useTransition } from "react"
import { CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn, toSelectItems } from "@/lib/utils"
import { t } from "@/content/strings"
import { holdPortfolio, releaseHold, allotPortfolio } from "../actions"
import { delegateChoices, ORDINAL } from "../_lib/balance"
import { delegateLine, type SerializedPortfolio, type SerializedCommittee, type SerializedDelegate, type Fee } from "./allotment-board"

interface Props {
  delegate: SerializedDelegate
  committees: SerializedCommittee[]
  fees: Fee[]
  paymentsRequired: boolean
  onClose: () => void
  onAllotted: (name: string, seat: string, hadWarning?: boolean) => void
}

// One delegate, one seat. Their own choices come first, already checked against
// the matrix; any other open seat is a committee pick away. The seat is held only
// for the moment of confirming, so an open dialog never blocks a colleague.
export function AllotDialog({ delegate, committees, fees, paymentsRequired, onClose, onAllotted }: Props) {
  const choices = delegateChoices(delegate, committees)
  const [open, setOpen] = useState(true)
  const [chosen, setChosen] = useState<SerializedPortfolio | null>(
    () => choices.find((c) => c.seat?.status === "AVAILABLE")?.seat ?? null,
  )
  const [browseId, setBrowseId] = useState(choices[0]?.committee.id ?? committees[0]?.id ?? "")
  const [isPending, startTransition] = useTransition()

  const browse = committees.find((c) => c.id === browseId)
  const openSeats = browse?.portfolios.filter((p) => p.status === "AVAILABLE") ?? []
  const chosenCommittee = chosen ? committees.find((c) => c.id === chosen.committeeId) : undefined
  const fee =
    paymentsRequired && chosenCommittee
      ? fees.find((f) => f.committeeType === chosenCommittee.type && f.isDtu === delegate.isDtu) ?? null
      : null
  const committeeItems = toSelectItems(committees, (c) => c.id, (c) => c.name)

  const close = () => {
    if (isPending) return
    setOpen(false)
    onClose()
  }

  const handleConfirm = () => {
    if (!chosen) return
    const seat = chosen
    startTransition(async () => {
      try {
        const hold = await holdPortfolio(seat.id)
        if (!hold.success || !hold.holdToken) {
          toast.error("A colleague is giving out that seat right now. Pick another.")
          return
        }
        const holdToken = hold.holdToken
        const result = await allotPortfolio({
          portfolioId: seat.id,
          committeeId: seat.committeeId,
          delegateId: delegate.id,
          holdToken,
        })
        if (result.success) {
          setOpen(false)
          if (result.warning) toast.warning(result.warning, { duration: 10000 })
          onAllotted(delegate.fullName, seat.name, !!result.warning)
          return
        }
        await releaseHold(seat.id, holdToken).catch(() => {})
        toast.error(result.error ?? "Could not give that seat.")
        if (result.code === "ALREADY_ALLOTTED" || result.code === "DELEGATE_UNAVAILABLE") {
          setOpen(false)
          onClose()
        }
      } catch {
        toast.error("Could not reach the server. Try again.")
      }
    })
  }

  const seatButton = (seat: SerializedPortfolio, label: React.ReactNode, note: string | null, full: boolean) => {
    const available = seat.status === "AVAILABLE"
    const picked = chosen?.id === seat.id
    return (
      <button
        key={seat.id}
        type="button"
        disabled={!available}
        onClick={() => setChosen(seat)}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
          full && "w-full",
          available ? "border-border/60 hover:border-primary/50 hover:bg-primary/5" : "cursor-not-allowed border-border/40 opacity-60",
          picked && "border-primary bg-primary/10",
        )}
      >
        <span className="min-w-0 flex-1">{label}</span>
        {note && <span className="shrink-0 text-xs text-muted-foreground">{note}</span>}
        {picked && <CheckCircle2 className="size-4 shrink-0 text-primary" />}
      </button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-2xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>{`Give ${delegate.fullName} a seat`}</DialogTitle>
          <DialogDescription>
            {`${delegateLine(delegate)} · ${delegate.email}`}
            {delegate.coDelegate ? ` · with ${delegate.coDelegate.fullName}` : ""}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What they asked for</h3>
          {choices.length === 0 ? (
            <p className="text-sm text-muted-foreground">They did not choose a committee. Pick any open seat below.</p>
          ) : (
            choices.map((ch) =>
              ch.seat ? (
                seatButton(
                  ch.seat,
                  <>
                    <span className="mr-2 text-xs text-muted-foreground">{`${ORDINAL[ch.rank]} choice`}</span>
                    <span className="font-medium">{`${ch.committee.name} · ${ch.seat.name}`}</span>
                  </>,
                  ch.seat.status === "AVAILABLE" ? "Open" : ch.seat.status === "ON_HOLD" ? "Being given out" : "Taken",
                  true,
                )
              ) : (
                <div key={ch.rank} className="flex items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2 text-sm">
                  <span className="text-xs text-muted-foreground">{`${ORDINAL[ch.rank]} choice`}</span>
                  <span className="min-w-0 flex-1 font-medium">
                    {ch.committee.name}
                    {ch.typed ? ` · ${ch.typed}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {ch.typed ? "No seat by that name" : "Any seat"}
                  </span>
                </div>
              ),
            )
          )}
        </section>

        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Or any open seat in</h3>
            <Select items={committeeItems} value={browseId} onValueChange={(v) => v && setBrowseId(v)}>
              <SelectTrigger className="h-8 w-56 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {committees.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {openSeats.length === 0 ? (
            <p className="text-sm text-muted-foreground">{`No open seats in ${browse?.name ?? "this committee"}.`}</p>
          ) : (
            <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {openSeats.map((p) => seatButton(p, p.name, null, false))}
            </div>
          )}
        </section>

        {chosen && chosenCommittee && (
          <div className="space-y-1 rounded-lg bg-muted/60 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{`${chosenCommittee.name} · ${chosen.name}`}</span>
              {!paymentsRequired ? (
                <span className="font-medium text-primary">Free · confirmed straight away</span>
              ) : fee ? (
                <span className="font-semibold text-primary">{`₹${fee.amountInr.toLocaleString("en-IN")}`}</span>
              ) : (
                <span className="text-xs text-amber-600 dark:text-amber-400">No fee set</span>
              )}
            </div>
            {paymentsRequired && !fee && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {`Add a fee for ${chosenCommittee.type.toLowerCase()} committees (${delegate.isDtu ? "DTU" : "non-DTU"}) in Setup, under Fees & payments.`}
              </p>
            )}
            {chosenCommittee.doubleDelegation && delegate.coDelegate && (
              <p className="text-xs text-muted-foreground">
                {t("admin.allotment.doubleDelegationNote", { committee: chosenCommittee.name })}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!chosen || isPending || (paymentsRequired && !fee)}>
            {isPending ? "Seating…" : chosen ? `Give them ${chosen.name}` : "Pick a seat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
