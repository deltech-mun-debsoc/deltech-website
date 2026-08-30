"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useRecruitmentLive } from "@/components/recruitment/use-recruitment-live"
import { cn } from "@/lib/utils"
import { t, type StringKey } from "@/content/strings"
import { setCandidateResult } from "../candidate-actions"
import type { CandidateResultName } from "@/lib/recruitment/transitions"

// One name per outcome, shared with ResultBadge, so the button and the badge it
// produces can never read differently.
const DECISIONS: Extract<CandidateResultName, "SELECTED" | "ON_HOLD" | "REJECTED">[] = [
  "SELECTED",
  "ON_HOLD",
  "REJECTED",
]

// The interview is the final assessment. There is no separate "advance to
// decision" step: these buttons apply the actual outcome and the Final selections tab
// reads that same result, so the two screens cannot drift apart.
export function PostInterviewDecision({
  cycleId,
  candidateId,
  currentResult,
  version,
  canHold,
  canFinalise,
}: {
  cycleId: string
  candidateId: string
  currentResult: string
  version: number
  canHold: boolean
  canFinalise: boolean
}) {
  const router = useRouter()
  const { notify } = useRecruitmentLive(cycleId)
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Post-interview decision">
      {DECISIONS.map((result) => {
        const permitted = result === "ON_HOLD" ? canHold : canFinalise
        if (!permitted) return null
        const active = currentResult === result
        const label = t(`recruitment.result.${result}` as StringKey)

        return (
          <Button
            key={result}
            type="button"
            size="sm"
            variant={active ? "default" : result === "REJECTED" ? "outline" : "secondary"}
            className={cn(result === "REJECTED" && !active && "text-destructive")}
            disabled={pending || active}
            aria-pressed={active}
            onClick={() =>
              startTransition(async () => {
                const response = await setCandidateResult({
                  candidateId,
                  to: result,
                  expectedVersion: version,
                })
                if (!response.ok) {
                  toast.error(response.error)
                  return
                }
                toast.success(`${label}: decision saved`)
                notify("candidate")
                router.refresh()
              })
            }
          >
            {label}
          </Button>
        )
      })}
    </div>
  )
}
