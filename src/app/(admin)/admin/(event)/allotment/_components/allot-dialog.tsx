"use client"

import { useState, useMemo, useEffect, useTransition } from "react"
import { Search, CheckCircle2 } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"
import { holdPortfolio, releaseHold, allotPortfolio } from "../actions"
import { preferenceRank, portfolioRank } from "../_lib/balance"
import type { SerializedPortfolio, SerializedCommittee, SerializedDelegate, Fee } from "./allotment-board"

interface Props {
  portfolio: SerializedPortfolio
  committee: SerializedCommittee
  delegates: SerializedDelegate[]
  fees: Fee[]
  paymentsRequired: boolean
  onClose: () => void
  onAllotted: (hadWarning?: boolean) => void
}

interface RankedDelegate extends SerializedDelegate {
  preferenceRank: 1 | 2 | 3 | null
  seatRank: 1 | 2 | 3 | null
}

export function AllotDialog({
  portfolio,
  committee,
  delegates,
  fees,
  paymentsRequired,
  onClose,
  onAllotted,
}: Props) {
  const [open, setOpen] = useState(true)
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<SerializedDelegate | null>(null)
  const [isPending, startTransition] = useTransition()
  const [holdToken, setHoldToken] = useState<string | null>(null)
  const [holdFailed, setHoldFailed] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null)

  // Soft-lock the portfolio when the dialog mounts
  useEffect(() => {
    holdPortfolio(portfolio.id)
      .then((result) => {
        setHoldToken(result.holdToken ?? null)
        setHoldFailed(!result.success)
        setHoldExpiresAt(result.holdExpiresAt ? Date.parse(result.holdExpiresAt) : null)
      })
      .catch(() => setHoldFailed(true))
  }, [portfolio.id])

  useEffect(() => {
    return () => {
      if (holdToken) void releaseHold(portfolio.id, holdToken).catch(() => {})
    }
  }, [holdToken, portfolio.id])

  // A dialog left open in a background tab kept its seat held until the two
  // minutes ran out, invisible to every other admin. Hiding the tab now gives the
  // seat back and closes the dialog, so the board is never blocked by a tab
  // nobody is looking at. Unmount alone does not cover this: a hidden tab never
  // unmounts.
  useEffect(() => {
    if (!holdToken) return
    const onHidden = () => {
      if (document.visibilityState !== "hidden" || isPending) return
      void releaseHold(portfolio.id, holdToken).catch(() => {})
      setHoldToken(null)
      setOpen(false)
      onClose()
    }
    document.addEventListener("visibilitychange", onHidden)
    return () => document.removeEventListener("visibilitychange", onHidden)
  }, [holdToken, portfolio.id, isPending, onClose])

  // The hold lasts two minutes and used to run out invisibly, so a conversation
  // with a delegate could outlast it and Confirm would fail with "your hold
  // expired". Counting down is display only: the server rechecks expiry inside
  // the transaction and stays the authority on whether this seat is still ours.
  useEffect(() => {
    if (!holdExpiresAt) return
    const tick = () => {
      const left = Math.max(0, Math.round((holdExpiresAt - Date.now()) / 1000))
      setSecondsLeft(left)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [holdExpiresAt])

  // Ranked candidate list. Someone who asked for THIS seat comes before someone
  // who only asked for this committee, because that is the question being asked
  // at the desk: who wanted this chair? Within a group, earlier registration wins.
  const rankedDelegates = useMemo((): RankedDelegate[] => {
    return delegates
      .map((d) => ({
        ...d,
        preferenceRank: preferenceRank(d, committee.id),
        seatRank: portfolioRank(d, {
          id: portfolio.id,
          name: portfolio.name,
          committeeId: committee.id,
        }),
      }))
      .sort((a, b) => {
        const sa = a.seatRank ?? 99
        const sb = b.seatRank ?? 99
        if (sa !== sb) return sa - sb
        const ra = a.preferenceRank ?? 99
        const rb = b.preferenceRank ?? 99
        if (ra !== rb) return ra - rb
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      })
  }, [delegates, committee.id, portfolio.id, portfolio.name])

  const filtered = useMemo(() => {
    if (!search.trim()) return rankedDelegates
    const q = search.toLowerCase()
    return rankedDelegates.filter(
      (d) =>
        d.fullName.toLowerCase().includes(q) ||
        d.email.toLowerCase().includes(q) ||
        d.institution.toLowerCase().includes(q),
    )
  }, [rankedDelegates, search])

  const computedFee = useMemo(() => {
    if (!selected || !paymentsRequired) return null
    return fees.find((f) => f.committeeType === committee.type && f.isDtu === selected.isDtu) ?? null
  }, [selected, fees, committee.type, paymentsRequired])

  const handleConfirm = () => {
    if (!selected || !holdToken) return
    startTransition(async () => {
      const result = await allotPortfolio({
        portfolioId: portfolio.id,
        committeeId: committee.id,
        delegateId: selected.id,
        holdToken,
      })
      if (result.success) {
        setOpen(false)
        // Allotted, but something after the commit did not land. Surface it
        // rather than letting the generic success toast paper over it.
        if (result.warning) toast.warning(result.warning, { duration: 10000 })
        onAllotted(!!result.warning)
      } else {
        toast.error(result.error ?? "Allotment failed.")
        if (result.code === "ALREADY_ALLOTTED" || result.code === "HOLD_LOST") {
          setOpen(false)
          onClose()
        }
      }
    })
  }

  const handleOpenChange = (o: boolean) => {
    if (!o && !isPending) {
      setOpen(false)
      // Only give back a hold we actually took, so closing this dialog can
      // never free a portfolio another admin is holding.
      if (holdToken) void releaseHold(portfolio.id, holdToken).catch(() => {})
      onClose()
    }
  }

  const onHoldByOther = holdFailed
  const holdLapsed = secondsLeft !== null && secondsLeft <= 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>Allot portfolio</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{portfolio.name}</span>
            {" · "}
            {committee.name}
            {!onHoldByOther && secondsLeft !== null && (
              <span className={cn("ml-2", holdLapsed ? "text-destructive" : "text-muted-foreground")}>
                {holdLapsed
                  ? t("admin.allotment.holdLapsed")
                  : t("admin.allotment.holdCountdown", { seconds: secondsLeft })}
              </span>
            )}
            {onHoldByOther && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                ⚠ On hold by another admin
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {committee.doubleDelegation && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
            {t("admin.allotment.doubleDelegationNote", { committee: committee.name })}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search delegates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Candidate list */}
        <div className="max-h-64 divide-y divide-border/40 overflow-y-auto rounded-lg border border-border/60">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No matching delegates.</p>
          ) : (
            filtered.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelected(d)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60",
                  selected?.id === d.id && "bg-primary/10",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{d.fullName}</span>
                    {/* DTU only changes the fee, so it is noise when nothing is charged. */}
                    {paymentsRequired && d.isDtu && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                        DTU
                      </span>
                    )}
                    {d.seatRank !== null && (
                      <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {t("admin.allotment.requestedThisSeat", { rank: d.seatRank })}
                      </span>
                    )}
                    {d.seatRank === null && d.preferenceRank === 1 && (
                      <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                        1st choice committee
                      </span>
                    )}
                    {d.seatRank === null && d.preferenceRank === 2 && (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        2nd choice committee
                      </span>
                    )}
                    {d.seatRank === null && d.preferenceRank === 3 && (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        3rd choice committee
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {d.isDtu ? d.email : `${d.email} · ${d.institution}`}
                  </p>
                  {committee.doubleDelegation && d.coDelegate && (
                    <p className="truncate text-xs text-muted-foreground">
                      + {d.coDelegate.fullName} (co-delegate)
                    </p>
                  )}
                </div>
                {selected?.id === d.id && (
                  <CheckCircle2 className="size-4 shrink-0 text-primary" />
                )}
              </button>
            ))
          )}
        </div>

        {/* Selected summary with computed fee */}
        {selected && (
          <div className="space-y-1 rounded-lg bg-muted/60 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{selected.fullName}</span>
              {!paymentsRequired ? (
                <span className="font-semibold text-primary">Free · confirmed immediately</span>
              ) : computedFee ? (
                <span className="font-semibold text-primary">
                  ₹{computedFee.amountInr.toLocaleString("en-IN")}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">No fee row found</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{selected.email}</p>
            {paymentsRequired && !computedFee && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠ No fee for {committee.type} / {selected.isDtu ? "DTU" : "non-DTU"}. Payment row
                will be skipped.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selected || !holdToken || isPending || holdLapsed || (paymentsRequired && !computedFee)}
          >
            {isPending ? "Allotting…" : paymentsRequired ? "Confirm allotment" : "Confirm free allotment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
