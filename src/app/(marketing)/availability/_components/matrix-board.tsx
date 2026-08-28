"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { motion, useReducedMotion } from "framer-motion"
import { getSupabase } from "@/lib/supabase"
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
    "border-border/40 bg-muted/60 text-muted-foreground/60 line-through",
}

const LEGEND: { state: PortfolioState; label: string; square: string }[] = [
  { state: "available", label: t("marketing.statusAvailable"), square: "bg-card border border-foreground/25" },
  { state: "allotted", label: t("marketing.statusAllotted"), square: "bg-accent border border-gold-500/50" },
  { state: "paid", label: t("marketing.statusConfirmed"), square: "bg-primary/15 border border-primary/50" },
]

export function MatrixBoard({ committees }: { committees: MatrixCommittee[] }) {
  const router = useRouter()
  const reduce = useReducedMotion()
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Any Portfolio or Delegate change (allot / revoke / pay) → debounced refresh.
  // Server recomputes states; simpler and safer than client-side cell math.
  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => router.refresh(), 800)
    }

    const supabase = getSupabase()
    if (!supabase) return

    const channel = supabase
      .channel("portfolio-matrix")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "Portfolio" }, scheduleRefresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "Delegate" }, scheduleRefresh)
      .subscribe()

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [router])

  return (
    <div>
      <div className="mb-14 flex flex-wrap items-center gap-x-8 gap-y-4 border-y border-foreground/20 py-5">
        {LEGEND.map((l) => (
          <span
            key={l.state}
            className="data-label flex items-center gap-2 text-muted-foreground"
          >
            <span className={`size-3 rounded-[2px] ${l.square}`} />
            {l.label}
          </span>
        ))}
      </div>

      {committees.map((committee, ci) => {
        const openCount = committee.portfolios.filter((p) => p.state === "available").length
        return (
          <motion.section
            key={committee.id}
            initial={reduce ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: Math.min(ci * 0.05, 0.3), ease: "easeOut" }}
            className="grid border-b border-foreground/20 py-10 lg:grid-cols-[5rem_0.72fr_1.28fr] lg:gap-10 lg:py-14"
          >
            <p className="mb-5 font-mono text-sm font-semibold text-primary lg:mb-0">{String(ci + 1).padStart(2, "0")}</p>
            <div>
              <div>
                <h2 className="font-heading text-4xl leading-none md:text-5xl">{committee.name}</h2>
                <p className="data-label mt-4 text-muted-foreground">
                  {TYPE_LABEL[committee.type]}
                  {committee.doubleDelegation && " · " + t("marketing.doubleDelegation")}
                </p>
                {committee.agenda && (
                  <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">{committee.agenda}</p>
                )}
              </div>
              <span
                className={`mt-6 inline-flex items-center gap-2 font-mono text-sm font-semibold tabular-nums ${openCount === 0 ? "text-destructive" : "text-primary"}`}
              >
                <span className={openCount === 0 ? "size-2 rounded-full bg-destructive" : "signal-dot"} />
                {openCount === 0 ? t("marketing.statusFull") : openCount + " " + t("marketing.openLabel")}
              </span>
            </div>

            <div className="mt-9 lg:mt-0">
              {committee.portfolios.length === 0 ? (
                <div className="border-y border-dashed border-border py-8">
                  <p className="font-heading text-2xl">{t("marketing.matrixComingSoon")}</p>
                  <p className="mt-2 text-base text-muted-foreground">{t("marketing.matrixComingSoonBody")}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {committee.portfolios.map((p) => (
                  <div
                    key={p.id}
                    title={
                      p.state === "allotted"
                        ? t("marketing.statusAllotted")
                        : p.state === "paid"
                          ? t("marketing.statusConfirmed")
                          : p.state === "blocked"
                            ? t("marketing.statusBlocked")
                            : t("marketing.statusAvailable")
                    }
                    className={`flex min-h-14 items-center border px-3 py-3 text-sm font-semibold leading-snug transition-colors ${STATE_STYLE[p.state]}`}
                  >
                    {p.name}
                  </div>
                ))}
              </div>
              )}
            </div>
          </motion.section>
        )
      })}
    </div>
  )
}
