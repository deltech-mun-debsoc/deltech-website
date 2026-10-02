"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { holdPortfolio, releaseHold, allotPortfolio } from "../actions"
import { delegateChoices, ORDINAL } from "../_lib/balance"
import type { SerializedCommittee, SerializedDelegate, SerializedPortfolio, Fee } from "./allotment-board"

interface Props {
  delegate: SerializedDelegate
  committees: SerializedCommittee[]
  fees: Fee[]
  paymentsRequired: boolean
  onAllotted: (name: string, seat: string, hadWarning?: boolean) => void
  onGone: () => void
}

// One dropdown per waiting delegate: their open choices first, then every open
// seat by committee. Picking only stages the seat; Allot commits it. The seat is
// held just for the moment of committing, so an open dropdown never blocks a
// colleague.
export function SeatPicker({ delegate, committees, fees, paymentsRequired, onAllotted, onGone }: Props) {
  const [seatId, setSeatId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const open = (c: SerializedCommittee) => c.portfolios.filter((p) => p.status === "AVAILABLE")
  const choices = delegateChoices(delegate, committees).filter((ch) => ch.seat?.status === "AVAILABLE")
  const seats = new Map<string, { seat: SerializedPortfolio; committee: SerializedCommittee }>()
  for (const c of committees) for (const p of open(c)) seats.set(p.id, { seat: p, committee: c })

  const items = [...seats.values()].map(({ seat, committee }) => ({ value: seat.id, label: `${committee.name} · ${seat.name}` }))
  const picked = seatId ? seats.get(seatId) : undefined
  const fee =
    paymentsRequired && picked
      ? fees.find((f) => f.committeeType === picked.committee.type && f.isDtu === delegate.isDtu) ?? null
      : null
  const feeMissing = paymentsRequired && picked && !fee

  const allot = () => {
    if (!picked) return
    const { seat } = picked
    startTransition(async () => {
      try {
        const hold = await holdPortfolio(seat.id)
        if (!hold.success || !hold.holdToken) {
          toast.error("A colleague is allotting that seat right now. Pick another.")
          setSeatId(null)
          return
        }
        const result = await allotPortfolio({
          portfolioId: seat.id,
          committeeId: seat.committeeId,
          delegateId: delegate.id,
          holdToken: hold.holdToken,
        })
        if (result.success) {
          if (result.warning) toast.warning(result.warning, { duration: 10000 })
          onAllotted(delegate.fullName, seat.name, !!result.warning)
          return
        }
        await releaseHold(seat.id, hold.holdToken).catch(() => {})
        toast.error(result.error ?? "Could not allot that seat.")
        if (result.code === "ALREADY_ALLOTTED" || result.code === "DELEGATE_UNAVAILABLE") onGone()
      } catch {
        toast.error("Could not reach the server. Try again.")
      }
    })
  }

  if (seats.size === 0) return <span className="text-xs text-muted-foreground">No open seats</span>

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Select items={items} value={seatId} onValueChange={(v) => setSeatId(v)} disabled={pending}>
        <SelectTrigger size="sm" className="w-56 text-sm" aria-label={`Seat for ${delegate.fullName}`}>
          <SelectValue placeholder="Choose a seat" />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {choices.length > 0 && (
            <SelectGroup>
              <SelectLabel>Asked for</SelectLabel>
              {choices.map((ch) => (
                <SelectItem key={`choice-${ch.seat!.id}`} value={ch.seat!.id}>
                  {`${ORDINAL[ch.rank]} · ${ch.committee.name} · ${ch.seat!.name}`}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {committees.map((c) => {
            const list = open(c).filter((p) => !choices.some((ch) => ch.seat?.id === p.id))
            if (list.length === 0) return null
            return (
              <SelectGroup key={c.id}>
                <SelectLabel>{`${c.name} · ${open(c).length} open`}</SelectLabel>
                {list.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectGroup>
            )
          })}
        </SelectContent>
      </Select>
      {picked && (
        <>
          {paymentsRequired && (
            <span className={feeMissing ? "text-xs text-amber-600 dark:text-amber-400" : "text-xs tabular-nums text-muted-foreground"}>
              {fee ? `₹${fee.amountInr.toLocaleString("en-IN")}` : "No fee set"}
            </span>
          )}
          <Button size="sm" onClick={allot} disabled={pending || !!feeMissing}>
            {pending ? "Allotting…" : "Allot"}
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setSeatId(null)} disabled={pending} aria-label="Clear seat">
            <X />
          </Button>
        </>
      )}
    </div>
  )
}
