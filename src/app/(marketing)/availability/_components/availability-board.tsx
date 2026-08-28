"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { getSupabase } from "@/lib/supabase"
import { t } from "@/content/strings"

export interface CommitteeAvailability {
  id: string
  name: string
  type: "STANDARD" | "CRISIS" | "PRESS"
  doubleDelegation: boolean
  availableCount: number
}

interface Props {
  initial: CommitteeAvailability[]
}

const TYPE_LABEL: Record<string, string> = {
  STANDARD: t("marketing.committeeTypes.standard"),
  CRISIS: t("marketing.committeeTypes.crisis"),
  PRESS: t("marketing.committeeTypes.press"),
}

function CountBadge({ count }: { count: number }) {
  const color =
    count === 0
      ? "bg-destructive/10 text-destructive"
      : count <= 3
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-primary/10 text-primary"

  return (
    <div
      className={`flex h-20 w-24 flex-col items-center justify-center overflow-hidden font-mono font-semibold ${color}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={count}
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {count}
        </motion.span>
      </AnimatePresence>
      <span className="data-label mt-1 font-normal opacity-70">{t("marketing.openLabel")}</span>
    </div>
  )
}

export function AvailabilityBoard({ initial }: Props) {
  const [committees, setCommittees] = useState(initial)

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) return

    const channel = supabase
      .channel("portfolio-availability")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "Portfolio" },
        (payload) => {
          const next = payload.new as { committeeId: string; status: string }
          const prev = payload.old as { committeeId: string; status: string }

          const wasAvailable = prev.status === "AVAILABLE"
          const isAvailable = next.status === "AVAILABLE"

          if (wasAvailable === isAvailable) return // no change to available count

          setCommittees((cs) =>
            cs.map((c) => {
              if (c.id !== next.committeeId) return c
              return {
                ...c,
                availableCount: c.availableCount + (isAvailable ? 1 : -1),
              }
            }),
          )
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  return (
    <div className="border-t border-foreground/20">
      {committees.map((committee, index) => (
        <motion.div
          key={committee.id}
          layout
          className="grid items-center gap-5 border-b border-foreground/20 py-7 sm:grid-cols-[4rem_1fr_auto]"
        >
          <span className="font-mono text-sm font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-3xl leading-tight text-card-foreground">{committee.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="data-label mt-2 text-muted-foreground">
                {TYPE_LABEL[committee.type]}
                {committee.doubleDelegation && " · " + t("marketing.doubleDelegation")}
              </span>
            </div>
          </div>
          <CountBadge count={Math.max(0, committee.availableCount)} />
        </motion.div>
      ))}
    </div>
  )
}
