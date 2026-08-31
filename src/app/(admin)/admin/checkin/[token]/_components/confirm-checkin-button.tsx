"use client"

import { formatDateTime } from "@/lib/datetime"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { t } from "@/content/strings"
import { checkInDelegate, undoCheckIn } from "../../actions"

interface Props {
  delegateId: string
  checkedInAt: string | null
  checkedInBy: string | null
}

export function ConfirmCheckinButton({ delegateId, checkedInAt, checkedInBy }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [state, setState] = useState({ checkedInAt, checkedInBy })

  const handleCheckIn = () => {
    startTransition(async () => {
      const result = await checkInDelegate(delegateId)
      if (result.success) {
        setState({ checkedInAt: result.checkedInAt, checkedInBy: result.checkedInBy })
        router.refresh()
      }
    })
  }

  const handleUndo = () => {
    startTransition(async () => {
      const result = await undoCheckIn(delegateId)
      if (result.success) {
        setState({ checkedInAt: result.checkedInAt, checkedInBy: result.checkedInBy })
        router.refresh()
      }
    })
  }

  if (state.checkedInAt) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-muted-foreground">
          {t("checkin.alreadyCheckedIn", { time: formatDateTime(state.checkedInAt), by: state.checkedInBy ?? "-" })}
        </p>
        <Button variant="outline" size="lg" className="w-full" disabled={isPending} onClick={handleUndo}>
          {t("checkin.undoButton")}
        </Button>
      </div>
    )
  }

  return (
    <Button size="lg" className="h-14 w-full text-base" disabled={isPending} onClick={handleCheckIn}>
      {t("checkin.confirmButton")}
    </Button>
  )
}
