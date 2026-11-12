"use client"

import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import { useVisiblePoll } from "@/lib/use-visible-poll"
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
      className={`flex h-16 w-20 flex-col items-center justify-center overflow-hidden rounded-lg text-xl font-semibold tabular-nums ${color}`}
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
      <span className="text-xs font-medium">{t("marketing.openLabel")}</span>
    </div>
  )
}

export function AvailabilityBoard({ initial }: Props) {
  const router = useRouter()
  // Counts come from the server render; a refresh replaces them. Polled every
  // 20s while the tab is visible.
  useVisiblePoll(20_000, router.refresh)
  const committees = initial

  return (
    <div className="border-t border-foreground/20">
      {committees.map((committee) => (
        <motion.div
          key={committee.id}
          layout
          className="flex items-center justify-between gap-5 border-b border-foreground/20 py-5"
        >
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">{committee.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {TYPE_LABEL[committee.type]}
              {committee.doubleDelegation && " · " + t("marketing.doubleDelegation")}
            </p>
          </div>
          <CountBadge count={Math.max(0, committee.availableCount)} />
        </motion.div>
      ))}
    </div>
  )
}
