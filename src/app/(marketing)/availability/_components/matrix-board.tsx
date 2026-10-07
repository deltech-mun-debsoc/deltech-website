"use client"

import { useRouter } from "next/navigation"
import { useVisiblePoll } from "@/lib/use-visible-poll"
import { t } from "@/content/strings"

export type PortfolioState = "available" | "allotted" | "paid" | "blocked"

export interface MatrixCommittee {
  id: string
  name: string
  agenda: string | null
  type: "STANDARD" | "CRISIS" | "PRESS"
  doubleDelegation: boolean
  portfolios: { id: string; name: string; state: PortfolioState }[]
}

const TYPE_LABEL: Record<string, string> = {
  STANDARD: t("marketing.committeeTypes.standard"),
  CRISIS: t("marketing.committeeTypes.crisis"),
  PRESS: t("marketing.committeeTypes.press"),
}

const STATE_STYLE: Record<PortfolioState, string> = {
  available:
    "border-foreground/20 bg-card text-foreground hover:border-primary",
  allotted:
    "border-gold-500/40 bg-accent text-accent-foreground",
  paid:
    "border-primary/40 bg-primary/10 text-primary",
  blocked:
    "border-border/60 bg-muted/60 text-muted-foreground",
}

// What a cell is called depends on whether the event charges, not on what the
// event is named. A free event has nothing pending and nothing paid.
function stateLabel(state: PortfolioState, paymentsRequired: boolean): string {
  if (state === "allotted") {
    return paymentsRequired ? t("marketing.statusAllotted") : t("marketing.statusAllottedFree")
  }
  if (state === "paid") {
    return paymentsRequired ? t("marketing.statusConfirmed") : t("marketing.statusConfirmedFree")
  }
  return state === "blocked" ? t("marketing.statusBlocked") : t("marketing.statusAvailable")
}

const LEGEND_STATES: { state: PortfolioState; square: string }[] = [
  { state: "available", square: "bg-card border border-foreground/25" },
  { state: "allotted", square: "bg-accent border border-gold-500/50" },
  { state: "paid", square: "bg-primary/15 border border-primary/50" },
]

export function MatrixBoard({
  committees,
  paymentsRequired = true,
}: {
  committees: MatrixCommittee[]
  paymentsRequired?: boolean
}) {
  const router = useRouter()

  // The server recomputes every cell's state, so a refresh is the whole update:
  // simpler and safer than client-side cell math. Polled: seats change a few
  // times a minute, so a 20s lag is invisible.
  useVisiblePoll(20_000, router.refresh)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border pb-5">
        {LEGEND_STATES.map((l) => (
          <span
            key={l.state}
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <span className={`size-3 rounded-[2px] ${l.square}`} />
            {stateLabel(l.state, paymentsRequired)}
          </span>
        ))}
      </div>

      {committees.map((committee) => {
        const openCount = committee.portfolios.filter((p) => p.state === "available").length
        return (
          <section
            key={committee.id}
            className="grid border-b border-border py-8 lg:grid-cols-[0.72fr_1.28fr] lg:gap-10"
          >
            <div>
              <div>
                <h2 className="text-xl font-semibold">{committee.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {TYPE_LABEL[committee.type]}
                  {committee.doubleDelegation && " · " + t("marketing.doubleDelegation")}
                </p>
                {committee.agenda && (
                  <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground">{committee.agenda}</p>
                )}
              </div>
              <span
                className={`mt-3 inline-flex text-sm font-semibold tabular-nums ${openCount === 0 ? "text-muted-foreground" : "text-primary"}`}
              >
                {openCount === 0 ? t("marketing.statusFull") : t("marketing.openCount", { n: openCount })}
              </span>
            </div>

            <div className="mt-9 lg:mt-0">
              {committee.portfolios.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-5 text-base text-muted-foreground">{t("marketing.matrixComingSoon")}</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {committee.portfolios.map((p) => (
                  <div
                    key={p.id}
                    title={stateLabel(p.state, paymentsRequired)}
                    className={`flex min-h-12 flex-col justify-center rounded-md border px-3 py-2.5 text-sm font-medium leading-snug ${STATE_STYLE[p.state]}`}
                  >
                    {p.name}
                    {p.state === "available"
                      ? <span className="sr-only">{" · " + stateLabel(p.state, paymentsRequired)}</span>
                      : <span className="mt-0.5 text-xs font-normal">{stateLabel(p.state, false)}</span>}
                  </div>
                ))}
              </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
