"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Search, Undo2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { revokeAllotment } from "../actions"
import { committeeDemand, delegateChoices, ORDINAL } from "../_lib/balance"
import { AllotDialog } from "./allot-dialog"
import { useAllotmentLive } from "../_lib/use-allotment-live"
import type { CommitteeType, PortfolioStatus } from "@/generated/prisma/client"

// ── Serialized types (Dates converted to ISO strings for client props) ─────────

export interface SerializedAllotment {
  id: string
  delegateId: string
  committeeId: string
  portfolioId: string
  allottedAt: string
  allottedBy: string
  emailSentAt: string | null
  delegate: {
    id: string
    fullName: string
    email: string
    isDtu: boolean
    coDelegate: { id: string; fullName: string } | null
  }
}

export interface SerializedPortfolio {
  id: string
  committeeId: string
  name: string
  status: PortfolioStatus
  holdToken: string | null
  holdExpiresAt: string | null
  allotment: SerializedAllotment | null
}

export interface SerializedCommittee {
  id: string
  name: string
  type: CommitteeType
  doubleDelegation: boolean
  portfolios: SerializedPortfolio[]
}

export interface SerializedDelegate {
  id: string
  fullName: string
  email: string
  institution: string
  isDtu: boolean
  rollNumber: string | null
  munExperience: string | null
  pref1CommitteeId: string | null
  pref1Portfolio: string | null
  pref1PortfolioId: string | null
  pref2CommitteeId: string | null
  pref2Portfolio: string | null
  pref2PortfolioId: string | null
  pref3CommitteeId: string | null
  pref3Portfolio: string | null
  pref3PortfolioId: string | null
  coDelegate: { id: string; fullName: string } | null
  createdAt: string
}

export interface Fee {
  id: string
  label: string
  committeeType: string
  isDtu: boolean
  amountInr: number
}

interface Props {
  committees: SerializedCommittee[]
  delegates: SerializedDelegate[]
  fees: Fee[]
  paymentsRequired: boolean
  eventId: string | null
  // Opened straight from "Add and give a seat" on the delegate list.
  focusDelegateId: string | null
}

export function delegateLine(d: Pick<SerializedDelegate, "rollNumber" | "isDtu" | "institution">) {
  return d.rollNumber ?? (d.isDtu ? "DTU" : d.institution)
}

export function AllotmentBoard({ committees, delegates, fees, paymentsRequired, eventId, focusDelegateId }: Props) {
  const router = useRouter()
  const { notify } = useAllotmentLive(eventId)
  const refreshAndNotify = () => {
    router.refresh()
    notify()
  }
  const [search, setSearch] = useState("")
  const [seating, setSeating] = useState<SerializedDelegate | null>(
    () => delegates.find((d) => d.id === focusDelegateId) ?? null,
  )
  const [revokeTarget, setRevokeTarget] = useState<{ portfolio: SerializedPortfolio; committee: SerializedCommittee } | null>(null)
  const [revoking, setRevoking] = useState(false)

  const demand = useMemo(() => committeeDemand(delegates), [delegates])
  const q = search.trim().toLowerCase()
  const matches = (fields: (string | null | undefined)[]) => !q || fields.some((f) => f?.toLowerCase().includes(q))

  const waiting = delegates.filter((d) => matches([d.fullName, d.email, d.rollNumber, d.institution]))
  const seated = committees
    .flatMap((c) => c.portfolios.filter((p) => p.allotment).map((p) => ({ portfolio: p, committee: c })))
    .sort((a, b) => b.portfolio.allotment!.allottedAt.localeCompare(a.portfolio.allotment!.allottedAt))
  const seatedShown = seated.filter(({ portfolio: p, committee: c }) =>
    matches([p.allotment!.delegate.fullName, p.allotment!.delegate.email, p.name, c.name]),
  )

  const closeDialog = () => {
    setSeating(null)
    if (focusDelegateId) router.replace("/admin/allotment", { scroll: false })
    refreshAndNotify()
  }

  const handleAllotted = (name: string, seat: string, hadWarning?: boolean) => {
    closeDialog()
    if (!hadWarning) toast.success(`${name} is seated as ${seat}.`)
  }

  const handleRevoke = async () => {
    const allotment = revokeTarget?.portfolio.allotment
    if (!revokeTarget || !allotment) return
    setRevoking(true)
    try {
      const result = await revokeAllotment({
        allotmentId: allotment.id,
        portfolioId: revokeTarget.portfolio.id,
        delegateId: allotment.delegateId,
      })
      if (result.success) {
        toast.success(`${allotment.delegate.fullName} is back on the waiting list.`)
        setRevokeTarget(null)
        refreshAndNotify()
      } else {
        toast.error(result.error ?? "Could not take the seat back.")
      }
    } catch {
      toast.error("Could not reach the server. Try again.")
    } finally {
      setRevoking(false)
    }
  }

  if (committees.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No committees yet. Add them in Setup, under Committees & matrix.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {committees.map((c) => {
          const total = c.portfolios.length
          const taken = c.portfolios.filter((p) => p.status === "ALLOTTED").length
          const open = c.portfolios.filter((p) => p.status === "AVAILABLE").length
          const firsts = demand.get(c.id)?.p1 ?? 0
          const crowded = firsts > open
          return (
            <div key={c.id} className="rounded-xl border border-border/60 bg-card px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="shrink-0 text-xs tabular-nums text-muted-foreground">{`${taken}/${total} seated`}</p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${total ? (taken / total) * 100 : 0}%` }} />
              </div>
              <p className={cn("mt-2 text-xs", crowded ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                {`${open} open · ${firsts} waiting want it first`}
              </p>
            </div>
          )
        })}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a delegate or seat…"
          className="pl-8"
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        <section className="editorial-card overflow-hidden">
          <header className="flex items-baseline justify-between border-b border-border/60 px-4 py-3">
            <h2 className="font-heading text-lg">Waiting for a seat</h2>
            <span className="text-sm tabular-nums text-muted-foreground">{delegates.length}</span>
          </header>
          {waiting.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {delegates.length === 0 ? "Everyone who registered has a seat." : "No waiting delegate matches."}
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {waiting.map((d) => {
                const choices = delegateChoices(d, committees)
                return (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{d.fullName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {delegateLine(d)}
                        {d.coDelegate ? ` · with ${d.coDelegate.fullName}` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {choices.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No committee chosen</span>
                        ) : (
                          choices.map((ch) => {
                            const taken = ch.seat && ch.seat.status !== "AVAILABLE"
                            return (
                              <span
                                key={ch.rank}
                                title={taken ? "Already taken" : ch.seat ? "Still open" : "Not a seat in the matrix"}
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[11px]",
                                  ch.seat && !taken && "bg-primary/10 text-primary",
                                  taken && "bg-muted text-muted-foreground line-through",
                                  !ch.seat && "bg-muted text-muted-foreground",
                                )}
                              >
                                {`${ORDINAL[ch.rank]} ${ch.committee.name}${ch.seat ? ` · ${ch.seat.name}` : ch.typed ? ` · ${ch.typed}` : ""}`}
                              </span>
                            )
                          })
                        )}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setSeating(d)}>
                      Give a seat
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="editorial-card overflow-hidden">
          <header className="flex items-baseline justify-between border-b border-border/60 px-4 py-3">
            <h2 className="font-heading text-lg">Seated</h2>
            <span className="text-sm tabular-nums text-muted-foreground">{seated.length}</span>
          </header>
          {seatedShown.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {seated.length === 0 ? "Nobody has a seat yet." : "No seated delegate matches."}
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {seatedShown.map(({ portfolio: p, committee: c }) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.allotment!.delegate.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {`${c.name} · ${p.name}`}
                      {c.doubleDelegation && p.allotment!.delegate.coDelegate ? ` · with ${p.allotment!.delegate.coDelegate.fullName}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => setRevokeTarget({ portfolio: p, committee: c })}
                  >
                    <Undo2 className="size-3.5" /> Take back
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {seating && (
        <AllotDialog
          delegate={seating}
          committees={committees}
          fees={fees}
          paymentsRequired={paymentsRequired}
          onClose={closeDialog}
          onAllotted={handleAllotted}
        />
      )}

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(next) => !next && setRevokeTarget(null)}
        title="Take this seat back?"
        description={
          revokeTarget?.portfolio.allotment
            ? `${revokeTarget.portfolio.allotment.delegate.fullName} goes back to waiting and ${revokeTarget.committee.name} · ${revokeTarget.portfolio.name} opens up again. They are not emailed about it.`
            : ""
        }
        confirmLabel="Take seat back"
        destructive
        pending={revoking}
        onConfirm={() => void handleRevoke()}
      />
    </div>
  )
}
