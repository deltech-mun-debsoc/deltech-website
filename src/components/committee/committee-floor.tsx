"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toSelectItems } from "@/lib/utils"
import { t } from "@/content/strings"
import { useRealtime } from "@/lib/realtime/client"
import { useVisiblePoll } from "@/lib/use-visible-poll"
import type { BallotChoiceName, DaisOp, DelegateOp, VoteKindName, VoteMajorityName } from "@/lib/committee/floor"
import type { FloorResult, FloorView, VoteView } from "@/lib/committee/floor-server"
import type { Seat } from "./committee-chat"

// The mic and the vote, for both sides of the room. As with chat, correctness
// never rests on the realtime channel: a nudge, a reconnect and a slow poll all
// refetch the whole floor, which is small.

const POLL_MS = 30_000

interface Props {
  committeeId: string
  mode: "delegate" | "dais"
  seats: Seat[]
  daisAction?: (committeeId: string, expectedVersion: number, op: DaisOp) => Promise<FloorResult>
  delegateAction?: (committeeId: string, op: DelegateOp) => Promise<FloorResult>
}

const CHOICE_LABEL: Record<BallotChoiceName, string> = {
  YES: t("floor.yes"),
  NO: t("floor.no"),
  ABSTAIN: t("floor.abstain"),
}
// Select shows the raw value unless it is told the labels.
const KIND_ITEMS = [
  { value: "PROCEDURAL", label: t("floor.procedural") },
  { value: "SUBSTANTIVE", label: t("floor.substantive") },
]
const MAJORITY_ITEMS = [
  { value: "SIMPLE", label: t("floor.majoritySimple") },
  { value: "TWO_THIRDS", label: t("floor.majorityTwoThirds") },
]

export function CommitteeFloor({ committeeId, mode, seats, daisAction, delegateAction }: Props) {
  const [floor, setFloor] = useState<FloorView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const sync = useRef({ busy: false, again: false })

  const refresh = useCallback(async () => {
    const s = sync.current
    if (s.busy) {
      s.again = true
      return
    }
    s.busy = true
    try {
      do {
        s.again = false
        const res = await fetch(`/api/committee/${committeeId}/floor`, { cache: "no-store" })
        if (!res.ok) break
        setFloor((await res.json()) as FloorView)
      } while (s.again)
    } catch {
      // Offline or mid-deploy; the next nudge, reconnect or poll retries.
    } finally {
      s.busy = false
    }
  }, [committeeId])

  useEffect(() => {
    void refresh()
  }, [refresh])
  useRealtime<null>(`committee:${committeeId}`, {
    event: "floor",
    onEvent: () => void refresh(),
    onOpen: () => void refresh(),
  })
  useVisiblePoll(POLL_MS, () => void refresh())

  const run = (call: () => Promise<FloorResult>) => {
    setError(null)
    startTransition(async () => {
      try {
        const res = await call()
        if (!res.success) setError(res.error)
      } catch {
        setError(t("floor.errorNetwork"))
      }
      await refresh()
    })
  }
  const dais = (op: DaisOp) => {
    const version = floor?.session?.version
    if (daisAction && version !== undefined) run(() => daisAction(committeeId, version, op))
  }
  const delegate = (op: DelegateOp) => {
    if (delegateAction) run(() => delegateAction(committeeId, op))
  }

  if (!floor) return null
  if (!floor.session) {
    return (
      <section className="rounded-lg border border-border/70 p-4">
        <p className="text-sm text-muted-foreground">{t("floor.noSession")}</p>
      </section>
    )
  }

  const mic = floor.mic
  const mine = !!mic && floor.me?.portfolioId === mic.portfolioId

  return (
    <section className="space-y-5 rounded-lg border border-border/70 p-4">
      <div className="space-y-2">
        <h2 className="font-semibold">{t("floor.mic")}</h2>
        <p className="text-sm">
          {mine ? t("floor.micYours") : mic ? t("floor.micHeld", { name: mic.name }) : t("floor.micNobody")}
        </p>
        {mode === "dais" && (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              items={toSelectItems(seats, (s) => s.id, (s) => s.name)}
              value={null}
              onValueChange={(v: string | null) => v && dais({ op: "giveMic", portfolioId: v })}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder={t("floor.giveMic")} />
              </SelectTrigger>
              <SelectContent>
                {seats.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={pending || !mic} onClick={() => dais({ op: "takeMic" })}>
              {t("floor.takeMic")}
            </Button>
          </div>
        )}
      </div>

      <VotePanel floor={floor} mode={mode} pending={pending} dais={dais} delegate={delegate} />

      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  )
}

function VotePanel({ floor, mode, pending, dais, delegate }: {
  floor: FloorView
  mode: "delegate" | "dais"
  pending: boolean
  dais: (op: DaisOp) => void
  delegate: (op: DelegateOp) => void
}) {
  const [subject, setSubject] = useState("")
  const [kind, setKind] = useState<VoteKindName>("PROCEDURAL")
  const [majority, setMajority] = useState<VoteMajorityName>("SIMPLE")
  const v = floor.vote

  const result = (x: VoteView) => (
    <p className="text-sm">
      {t("floor.result", { yes: x.yes ?? 0, no: x.no ?? 0, abstain: x.abstain ?? 0 })}{" "}
      {x.passed !== null && <Badge variant={x.passed ? "default" : "destructive"}>{x.passed ? t("floor.passed") : t("floor.failed")}</Badge>}
    </p>
  )

  return (
    <div className="space-y-3">
      <h2 className="font-semibold">{t("floor.vote")}</h2>
      {!v ? (
        <p className="text-sm text-muted-foreground">{t("floor.noVote")}</p>
      ) : (
        <div className="space-y-2 rounded-md border border-border/70 p-3">
          <p className="font-medium">{v.subject}</p>
          <p className="text-xs text-muted-foreground">
            {v.kind === "PROCEDURAL" ? t("floor.procedural") : t("floor.substantive")} ·{" "}
            {v.majority === "SIMPLE" ? t("floor.majoritySimple") : t("floor.majorityTwoThirds")} ·{" "}
            {t("floor.castCount", { cast: v.cast, eligible: v.eligible })}
          </p>
          {mode === "dais" ? (
            <>
              {result(v)}
              {v.ballots && v.ballots.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {v.ballots.map((b) => `${b.portfolioName}: ${CHOICE_LABEL[b.choice]}`).join(" · ")}
                </p>
              )}
              <Button size="sm" disabled={pending} onClick={() => dais({ op: "closeVote", voteId: v.id })}>{t("floor.closeVote")}</Button>
            </>
          ) : v.myChoice ? (
            <p className="text-sm">{t("floor.youVoted", { choice: CHOICE_LABEL[v.myChoice] })} {t("floor.tallyHidden")}</p>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                {(["YES", "NO", "ABSTAIN"] as const).map((c) => (
                  <Button key={c} size="sm" variant={c === "YES" ? "default" : "outline"}
                    disabled={pending || (c === "ABSTAIN" && v.kind === "PROCEDURAL")}
                    onClick={() => delegate({ op: "castBallot", voteId: v.id, choice: c })}>
                    {CHOICE_LABEL[c]}
                  </Button>
                ))}
              </div>
              {v.kind === "PROCEDURAL" && <p className="text-xs text-muted-foreground">{t("floor.proceduralNote")}</p>}
            </div>
          )}
        </div>
      )}

      {floor.lastVote && (
        <div className="text-sm">
          <p className="text-xs text-muted-foreground">{t("floor.lastResult")}</p>
          <p className="font-medium">{floor.lastVote.subject}</p>
          {result(floor.lastVote)}
        </div>
      )}

      {mode === "dais" && !v && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); dais({ op: "openVote", subject, kind, majority }); setSubject("") }}>
          <Input value={subject} maxLength={200} placeholder={t("floor.subject")} aria-label={t("floor.subject")} onChange={(e) => setSubject(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Select items={KIND_ITEMS} value={kind} onValueChange={(x: string | null) => x && setKind(x as VoteKindName)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {KIND_ITEMS.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select items={MAJORITY_ITEMS} value={majority} onValueChange={(x: string | null) => x && setMajority(x as VoteMajorityName)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MAJORITY_ITEMS.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" type="submit" disabled={pending || !subject.trim()}>{t("floor.open")}</Button>
          </div>
        </form>
      )}
    </div>
  )
}
