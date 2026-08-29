"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { t } from "@/content/strings"
import { moveCandidateStage } from "../candidate-actions"
import type { CandidateStageName } from "@/lib/recruitment/transitions"

// Moves one candidate to the next stage in the pipeline.
//
// Finishing a session now advances the candidates who were present, so this is the
// recovery path rather than the main road: someone who was marked absent, whose
// group was aborted, or who was bypassed and never sat in a session at all would
// otherwise have no way forward. Before this existed the ONLY route from
// GD_COMPLETE to PI_PENDING was creating a brand new PI group.
//
// The server re-derives the destination and re-checks the capability, so the `to`
// passed here is a request, not an authorisation.
export function AdvanceCandidateButton({
  candidateId,
  to,
  label,
}: {
  candidateId: string
  to: CandidateStageName
  label: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 text-muted-foreground"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await moveCandidateStage({ candidateId, to })
          if (!result.ok) {
            toast.error(result.error)
            return
          }
          toast.success(result.idempotent ? t("recruitment.candidates.advanceAlready") : label)
          router.refresh()
        })
      }
    >
      <ArrowRight className="size-3.5" />
      {label}
    </Button>
  )
}
