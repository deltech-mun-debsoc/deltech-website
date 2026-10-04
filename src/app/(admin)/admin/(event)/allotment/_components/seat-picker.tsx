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

// Committee, then seat: each committee's matrix is its own list, so a 120-seat
// AIPPM never buries a 90-seat UNSC. The committee starts on their first choice
// that still has room, with their requested seats at the top of its list.
// Picking only stages the seat; Allot commits it. The seat is
// held just for the moment of committing, so an open dropdown never blocks a
// colleague.
export function SeatPicker({ delegate, committees, fees, paymentsRequired, onAllotted, onGone }: Props) {
  const open = (c: SerializedCommittee) => c.portfolios.filter((p) => p.status === "AVAILABLE")
  const withRoom = committees.filter((c) => open(c).length > 0)
  const choices = delegateChoices(delegate, committees)
  const [committeeId, setCommitteeId] = useState<string | null>(
    () => choices.find((ch) => open(ch.committee).length > 0)?.committee.id ?? null,
  )
  const [seatId, setSeatId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const committee = withRoom.find((c) => c.id === committeeId)
  const asked = choices.filter((ch) => ch.committee.id === committeeId && ch.seat?.status === "AVAILABLE")
  const rest = committee ? open(committee).filter((p) => !asked.some((ch) => ch.seat?.id === p.id)) : []
  const committeeItems = withRoom.map((c) => ({ value: c.id, label: `${c.name} · ${open(c).length} open` }))
  const seatItems = committee ? open(committee).map((p) => ({ value: p.id, label: p.name })) : []
  const seat: SerializedPortfolio | undefined = committee?.portfolios.find((p) => p.id === seatId)
  const picked = committee && seat ? { seat, committee } : undefined
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
          // Taken or being taken since this list loaded: refresh so it drops out.
          toast.error(`${seat.name} is no longer open. Pick another.`)
          setSeatId(null)
          onGone()
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

  if (withRoom.length === 0) return <span className="text-xs text-muted-foreground">No open seats</span>

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Select
        items={committeeItems}
        value={committeeId}
        onValueChange={(v) => {
          setCommitteeId(v)
          setSeatId(null)
        }}
        disabled={pending}
      >
        <SelectTrigger size="sm" className="w-40 text-sm" aria-label={`Committee for ${delegate.fullName}`}>
          <SelectValue placeholder="Committee">
            {(value: string | null) => withRoom.find((c) => c.id === value)?.name ?? "Committee"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {committeeItems.map((c) => (
            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select items={seatItems} value={seatId} onValueChange={(v) => setSeatId(v)} disabled={pending || !committee}>
        <SelectTrigger size="sm" className="w-48 text-sm" aria-label={`Seat for ${delegate.fullName}`}>
          <SelectValue placeholder="Seat" />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {asked.length > 0 && (
            <SelectGroup>
              <SelectLabel>Asked for</SelectLabel>
              {asked.map((ch) => (
                <SelectItem key={`asked-${ch.seat!.id}`} value={ch.seat!.id}>{`${ch.seat!.name} · ${ORDINAL[ch.rank]}`}</SelectItem>
              ))}
            </SelectGroup>
          )}
          <SelectGroup>
            {asked.length > 0 && <SelectLabel>Open</SelectLabel>}
            {rest.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectGroup>
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
