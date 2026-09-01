"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { revokeAllotment } from "../actions"
import { committeeDemand } from "../_lib/balance"
import { PortfolioCard } from "./portfolio-card"
import { AllotDialog } from "./allot-dialog"
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
  munExperience: string | null
  pref1CommitteeId: string | null
  pref1Portfolio: string | null
  pref2CommitteeId: string | null
  pref2Portfolio: string | null
  pref3CommitteeId: string | null
  pref3Portfolio: string | null
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
}

export function AllotmentBoard({ committees, delegates, fees, paymentsRequired }: Props) {
  const router = useRouter()
  const [selectedCommitteeId, setSelectedCommitteeId] = useState(committees[0]?.id ?? "")
  const [dialogPortfolio, setDialogPortfolio] = useState<SerializedPortfolio | null>(null)
  const [dialogCommittee, setDialogCommittee] = useState<SerializedCommittee | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<SerializedPortfolio | null>(null)
  const [revoking, setRevoking] = useState(false)

  const selectedCommittee = committees.find((c) => c.id === selectedCommitteeId)

  // Preference demand across the unallotted pool (delegates are REGISTERED only,
  // so this is *remaining* demand, the balancing signal). Recomputed as the
  // pool shrinks on router.refresh().
  const demand = useMemo(() => committeeDemand(delegates), [delegates])
  const selectedDemand = selectedCommittee ? demand.get(selectedCommittee.id) : undefined

  const handlePortfolioClick = (portfolio: SerializedPortfolio, committee: SerializedCommittee) => {
    if (portfolio.status === "ALLOTTED" || portfolio.status === "BLOCKED") return
    setDialogPortfolio(portfolio)
    setDialogCommittee(committee)
  }

  // Releasing the hold belongs to the dialog, which is the only thing that
  // knows whether *it* took the hold. This used to branch on the portfolio's
  // server-rendered status, which is exactly backwards: a portfolio that was
  // AVAILABLE at page load still reads AVAILABLE here, so our own hold was
  // never released, while one already ON_HOLD meant we released another
  // admin's hold on our way out.
  const handleDialogClose = () => {
    setDialogPortfolio(null)
    setDialogCommittee(null)
    router.refresh()
  }

  const handleAllotted = (hadWarning?: boolean) => {
    setDialogPortfolio(null)
    setDialogCommittee(null)
    router.refresh()
    // The dialog already showed the warning toast; don't contradict it.
    if (!hadWarning) toast.success("Portfolio allotted successfully.")
  }

  const handleRevoke = async (portfolio: SerializedPortfolio) => {
    if (!portfolio.allotment) return
    setRevoking(true)
    try {
      const result = await revokeAllotment({
        allotmentId: portfolio.allotment.id,
        portfolioId: portfolio.id,
        delegateId: portfolio.allotment.delegateId,
      })

      if (result.success) {
        toast.success("Allotment revoked.")
        setRevokeTarget(null)
        router.refresh()
      } else {
        toast.error(result.error ?? "Revoke failed.")
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
        No active committees. Add committees in Config.
      </p>
    )
  }

  return (
    <div className="flex gap-6 min-h-0">
      {/* Committee sidebar */}
      <aside className="w-48 shrink-0 space-y-0.5">
        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Committees
        </p>
        {committees.map((c) => {
          const allotted = c.portfolios.filter((p) => p.status === "ALLOTTED").length
          const total = c.portfolios.length
          const fill = total > 0 ? Math.round((allotted / total) * 100) : 0
          const d = demand.get(c.id)
          const p1 = d?.p1 ?? 0
          const available = total - allotted
          // Over-subscribed on 1st preference relative to remaining seats, the
          // cue to consider pushing some delegates to a 2nd preference.
          const oversubscribed = p1 > available && available > 0
          return (
            <button
              key={c.id}
              onClick={() => setSelectedCommitteeId(c.id)}
              className={cn(
                "w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                c.id === selectedCommitteeId
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="block font-medium leading-tight">{c.name}</span>
              <span className="mt-1 flex items-center gap-1.5">
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn("block h-full rounded-full", fill === 100 ? "bg-primary" : "bg-primary/60")}
                    style={{ width: `${fill}%` }}
                  />
                </span>
                <span className="text-[10px] tabular-nums opacity-70">{allotted}/{total}</span>
              </span>
              {d && (
                <span className="mt-1 flex items-center gap-1 text-[10px] opacity-70">
                  <span className={cn("tabular-nums", oversubscribed && "font-semibold text-amber-600 dark:text-amber-400")}>
                    P1 {p1}
                  </span>
                  <span className="tabular-nums">· P2 {d.p2}</span>
                  <span className="tabular-nums">· P3 {d.p3}</span>
                </span>
              )}
            </button>
          )
        })}
      </aside>

      {/* Portfolio grid */}
      <div className="flex-1 min-w-0">
        {selectedCommittee ? (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold">{selectedCommittee.name}</h2>
              {selectedCommittee.doubleDelegation && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  double delegation
                </span>
              )}
              <span className="text-sm text-muted-foreground">
                {selectedCommittee.portfolios.filter((p) => p.status === "AVAILABLE").length} available
                {" · "}
                {selectedCommittee.portfolios.filter((p) => p.status === "ALLOTTED").length} allotted
                {" · "}
                {selectedCommittee.portfolios.length} total
              </span>
              {selectedDemand && (
                <span className="text-sm text-muted-foreground">
                  {",  demand: "}
                  <span className="tabular-nums">{selectedDemand.p1}</span> pref-1
                  {" · "}
                  <span className="tabular-nums">{selectedDemand.p2}</span> pref-2
                  {" · "}
                  <span className="tabular-nums">{selectedDemand.p3}</span> pref-3
                  {" (unallotted pool)"}
                </span>
              )}
            </div>

            {selectedCommittee.portfolios.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No portfolios configured. Add them in Config.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {selectedCommittee.portfolios.map((portfolio) => (
                  <PortfolioCard
                    key={portfolio.id}
                    portfolio={portfolio}
                    committee={selectedCommittee}
                    onClick={() => handlePortfolioClick(portfolio, selectedCommittee)}
                    onRevoke={() => setRevokeTarget(portfolio)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Select a committee.</p>
        )}
      </div>

      {/* Allot dialog, rendered outside the grid so it isn't clipped */}
      {dialogPortfolio && dialogCommittee && (
        <AllotDialog
          portfolio={dialogPortfolio}
          committee={dialogCommittee}
          delegates={delegates}
          fees={fees}
          paymentsRequired={paymentsRequired}
          onClose={handleDialogClose}
          onAllotted={handleAllotted}
        />
      )}

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(next) => !next && setRevokeTarget(null)}
        title="Revoke this allotment?"
        description={
          revokeTarget?.allotment
            ? `Return ${revokeTarget.allotment.delegate.fullName}'s ${revokeTarget.name} portfolio to the available pool?`
            : ""
        }
        confirmLabel="Revoke allotment"
        destructive
        pending={revoking}
        onConfirm={() => revokeTarget && void handleRevoke(revokeTarget)}
      />
    </div>
  )
}
