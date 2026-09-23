"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { t } from "@/content/strings"
import { formatDateTime } from "@/lib/datetime"
import {
  hasQuorum,
  seatsShortOfQuorum,
  tally,
  type CommitteeAttendanceName,
} from "@/lib/committee/roll-call"
import { markAttendance } from "../actions"

export interface RollCallSeat {
  portfolioId: string
  portfolioName: string
  delegateName: string | null
  status: CommitteeAttendanceName
  markedAt: string | null
  markedById: string | null
}

// Order matters: this is the order a chair taps through, and "not called" is
// last because it is the state a seat leaves rather than one it is put into.
const MARKS: readonly CommitteeAttendanceName[] = [
  "PRESENT",
  "PRESENT_AND_VOTING",
  "LATE",
  "ABSENT",
]

const LABEL: Record<CommitteeAttendanceName, string> = {
  EXPECTED: t("rollCall.statusExpected"),
  PRESENT: t("rollCall.statusPresent"),
  PRESENT_AND_VOTING: t("rollCall.statusPresentAndVoting"),
  ABSENT: t("rollCall.statusAbsent"),
  LATE: t("rollCall.statusLate"),
}

export function RollCall({ sessionId, seats }: { sessionId: string; seats: RollCallSeat[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Optimistic marks, so a chair calling a roll of 45 is not waiting on a round
  // trip per seat. The server row replaces these on the next refresh.
  const [optimistic, setOptimistic] = useState<Record<string, CommitteeAttendanceName>>({})

  const rows = useMemo(
    () => seats.map((s) => ({ ...s, status: optimistic[s.portfolioId] ?? s.status })),
    [seats, optimistic],
  )

  const counts = useMemo(() => tally(rows.map((r) => r.status)), [rows])
  const quorum = hasQuorum(counts)
  const short = seatsShortOfQuorum(counts)

  const onMark = (portfolioId: string, status: CommitteeAttendanceName) => {
    setError(null)
    setOptimistic((prev) => ({ ...prev, [portfolioId]: status }))
    startTransition(async () => {
      const res = await markAttendance(sessionId, portfolioId, status)
      if (!res.success) {
        // Roll the optimistic mark back rather than leaving the chair looking at
        // a count the server never accepted.
        setOptimistic((prev) => {
          const next = { ...prev }
          delete next[portfolioId]
          return next
        })
        setError(res.error ?? null)
      }
      router.refresh()
    })
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-heading text-xl">{t("rollCall.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("rollCall.description")}</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {seats.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("rollCall.noSeats")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/70 p-4">
            <span className="text-sm font-medium">
              {t("rollCall.inRoom", { inRoom: counts.inRoom, total: counts.total })}
            </span>
            {quorum ? (
              <Badge>{t("rollCall.quorumMet")}</Badge>
            ) : (
              <Badge variant="outline">{t("rollCall.quorumShort", { n: short })}</Badge>
            )}
            <span className="text-xs text-muted-foreground">{t("rollCall.votingNote")}</span>
          </div>

          <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
            {rows.map((seat) => (
              <li
                key={seat.portfolioId}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-48">
                  <p className="text-sm font-medium">{seat.portfolioName}</p>
                  <p className="text-xs text-muted-foreground">
                    {seat.delegateName ?? t("rollCall.unallotted")}
                    {seat.markedById && seat.markedAt
                      ? ` ${t("rollCall.markedBy", { who: seat.markedById })} ${formatDateTime(seat.markedAt)}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {MARKS.map((mark) => (
                    <Button
                      key={mark}
                      size="sm"
                      variant={seat.status === mark ? "default" : "outline"}
                      disabled={pending}
                      onClick={() => onMark(seat.portfolioId, mark)}
                    >
                      {LABEL[mark]}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
