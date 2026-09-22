"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { t } from "@/content/strings"
import { formatDateTime } from "@/lib/datetime"
import {
  hasQuorum,
  seatsShortOfQuorum,
  tally,
  type CommitteeAttendanceName,
} from "@/lib/committee/roll-call"
import { closeSession, markAttendance, openSession } from "../actions"

export interface RollCallSeat {
  portfolioId: string
  portfolioName: string
  delegateName: string | null
  status: CommitteeAttendanceName
  markedAt: string | null
  markedById: string | null
}

interface SessionRef {
  id: string
  attempt: number
  version: number
  state: string
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

export function RollCallClient({
  committees,
  selectedCommitteeId,
  session,
  seats,
}: {
  committees: { id: string; name: string }[]
  selectedCommitteeId: string | null
  session: SessionRef | null
  seats: RollCallSeat[]
}) {
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

  // The Select hands back `string | null`; a cleared value has no committee to
  // navigate to, so it is ignored rather than pushing a bare URL.
  const onPickCommittee = (id: string | null) => {
    if (!id) return
    setOptimistic({})
    setError(null)
    router.push(`/admin/roll-call?committee=${id}`)
  }

  const onOpen = () => {
    if (!selectedCommitteeId) return
    setError(null)
    startTransition(async () => {
      const res = await openSession(selectedCommitteeId)
      if (!res.success) setError(res.error ?? null)
      router.refresh()
    })
  }

  const onClose = () => {
    if (!session) return
    setError(null)
    startTransition(async () => {
      const res = await closeSession(session.id, session.version)
      if (!res.success) setError(res.error ?? null)
      setOptimistic({})
      router.refresh()
    })
  }

  const onMark = (portfolioId: string, status: CommitteeAttendanceName) => {
    if (!session) return
    setError(null)
    setOptimistic((prev) => ({ ...prev, [portfolioId]: status }))
    startTransition(async () => {
      const res = await markAttendance(session.id, portfolioId, status)
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

  if (committees.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("rollCall.noCommittees")}</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedCommitteeId ?? undefined} onValueChange={onPickCommittee}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder={t("rollCall.pickCommittee")} />
          </SelectTrigger>
          <SelectContent>
            {committees.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {session ? (
          <>
            <Badge variant="secondary">{t("rollCall.attempt", { n: session.attempt })}</Badge>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              {t("rollCall.closeSession")}
            </Button>
          </>
        ) : (
          <Button onClick={onOpen} disabled={pending || !selectedCommitteeId}>
            {t("rollCall.openSession")}
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {seats.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("rollCall.noSeats")}</p>
      ) : !session ? (
        <p className="text-sm text-muted-foreground">{t("rollCall.noSession")}</p>
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
    </div>
  )
}
