"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
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
import { t } from "@/content/strings"
import { useRealtime } from "@/lib/realtime/client"
import { useVisiblePoll } from "@/lib/use-visible-poll"
import { clockSkewMs, skewCorrectedNow } from "@/lib/session"
import { isPresent, mayAbstain } from "@/lib/committee/roll-call"
import {
  remainingMs,
  type BallotChoiceName,
  type DaisOp,
  type DelegateOp,
  type MotionKindName,
} from "@/lib/committee/floor"
import type { ClockView, FloorResult, FloorView, MotionView, SpeakerView, VoteView } from "@/lib/committee/floor-server"
import type { Seat } from "./committee-chat"

// The floor for both sides of the room. As with chat, correctness never rests on
// the realtime channel: a nudge, a reconnect and a slow poll all refetch the whole
// floor, which is small. Clocks tick locally against server time, corrected for
// this device's clock skew, so a wrong phone clock cannot shorten a speech.

const POLL_MS = 30_000
const TICK_MS = 250

interface Props {
  committeeId: string
  mode: "delegate" | "dais"
  seats: Seat[]
  daisAction?: (committeeId: string, expectedVersion: number, op: DaisOp) => Promise<FloorResult>
  delegateAction?: (committeeId: string, op: DelegateOp) => Promise<FloorResult>
}

const KIND_LABEL: Record<MotionKindName, string> = {
  MODERATED_CAUCUS: t("floor.moderated"),
  UNMODERATED_CAUCUS: t("floor.unmoderated"),
  EXTEND: t("floor.extend"),
  CLOSE_DEBATE: t("floor.closeDebate"),
  OTHER: t("floor.other"),
}
const STATE_LABEL: Record<string, string> = {
  PROPOSED: t("floor.stateProposed"),
  VOTING: t("floor.stateVoting"),
  PASSED: t("floor.statePassed"),
  FAILED: t("floor.stateFailed"),
}
const CHOICE_LABEL: Record<BallotChoiceName, string> = {
  YES: t("floor.yes"),
  NO: t("floor.no"),
  ABSTAIN: t("floor.abstain"),
}

function toClock(c: ClockView) {
  const d = (s: string | null) => (s ? new Date(s) : null)
  return { ...c, startedAt: d(c.startedAt), pausedAt: d(c.pausedAt), endedAt: d(c.endedAt) }
}

function formatMs(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

export function CommitteeFloor({ committeeId, mode, seats, daisAction, delegateAction }: Props) {
  const router = useRouter()
  const [floor, setFloor] = useState<FloorView | null>(null)
  const [skew, setSkew] = useState(0)
  const [, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const sync = useRef({ busy: false, again: false, version: -1 })

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
        const view = (await res.json()) as FloorView
        setSkew(clockSkewMs(new Date(view.serverNow), new Date()))
        setFloor(view)
        // Roll call on the same page carries the session version for closing the
        // session. When another chair moves the floor, refresh it so that button
        // is not left holding a stale version.
        const version = view.session?.version ?? -1
        if (mode === "dais" && s.version !== -1 && version !== s.version) router.refresh()
        s.version = version
      } while (s.again)
    } catch {
      // Offline or mid-deploy; the next nudge, reconnect or poll retries.
    } finally {
      s.busy = false
    }
  }, [committeeId, mode, router])

  useEffect(() => {
    void refresh()
  }, [refresh])
  useRealtime<null>(`committee:${committeeId}`, {
    event: "floor",
    onEvent: () => void refresh(),
    onOpen: () => void refresh(),
  })
  useVisiblePoll(POLL_MS, () => void refresh())

  // Tick only while a clock is actually running.
  const running = !!floor && [...floor.gsl, ...(floor.caucus?.speakers ?? [])].some((s) => s.state === "SPEAKING" && !s.clock.pausedAt)
  const caucusRunning = !!floor?.caucus?.clock && !floor.caucus.clock.pausedAt
  useEffect(() => {
    if (!running && !caucusRunning) return
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS)
    return () => clearInterval(id)
  }, [running, caucusRunning])

  const now = skewCorrectedNow(new Date(), skew)

  const dais = (op: DaisOp) => {
    if (!daisAction || !floor?.session) return
    setError(null)
    const version = floor.session.version
    startTransition(async () => {
      try {
        const res = await daisAction(committeeId, version, op)
        if (!res.success) setError(res.error)
      } catch {
        setError(t("floor.errorNetwork"))
      }
      await refresh()
    })
  }
  const delegate = (op: DelegateOp) => {
    if (!delegateAction) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await delegateAction(committeeId, op)
        if (!res.success) setError(res.error)
      } catch {
        setError(t("floor.errorNetwork"))
      }
      await refresh()
    })
  }

  if (!floor) return null
  if (!floor.session) {
    return (
      <section className="rounded-lg border border-border/70 p-4">
        <h2 className="text-lg font-semibold">{t("floor.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("floor.noSession")}</p>
      </section>
    )
  }

  const clockText = (c: ClockView) => {
    const ms = remainingMs(toClock(c), now)
    return ms >= 0 ? formatMs(ms) : t("floor.overtime", { t: formatMs(ms) })
  }

  // A plain function, not a component: defined inside render, a component would
  // be a new type every tick and remount, snapping the dais's dropdown shut.
  const renderList = (speakers: SpeakerView[], motionId: string | null) => {
    const speaking = speakers.find((s) => s.state === "SPEAKING")
    const queued = speakers.filter((s) => s.state === "QUEUED")
    const mineQueued = floor.me && queued.some((s) => s.portfolioId === floor.me!.portfolioId)
    const mineLive = floor.me && speakers.some((s) => s.portfolioId === floor.me!.portfolioId)
    return (
      <div className="space-y-3">
        {speaking ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/40 p-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("floor.speaking")}</p>
              <p className="font-medium">{speaking.portfolioName}</p>
            </div>
            <p className={`font-mono text-2xl tabular-nums ${remainingMs(toClock(speaking.clock), now) < 0 ? "text-destructive" : ""}`}>
              {clockText(speaking.clock)}
            </p>
            {mode === "dais" && (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={pending}
                  onClick={() => dais({ op: speaking.clock.pausedAt ? "resumeSpeaker" : "pauseSpeaker", entryId: speaking.id })}>
                  {speaking.clock.pausedAt ? t("floor.resume") : t("floor.pause")}
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => dais({ op: "endSpeaker", entryId: speaking.id })}>
                  {t("floor.end")}
                </Button>
              </div>
            )}
          </div>
        ) : null}

        {queued.length === 0 && !speaking ? (
          <p className="text-sm text-muted-foreground">{t("floor.emptyList")}</p>
        ) : (
          <ol className="space-y-1 text-sm">
            {queued.map((s, i) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span>{i + 1}. {s.portfolioName}</span>
                {mode === "dais" && (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => dais({ op: "removeSpeaker", entryId: s.id })}>
                    {t("floor.remove")}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}

        {mode === "dais" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={pending} onClick={() => dais({ op: "nextSpeaker", motionId })}>
              {t("floor.next")}
            </Button>
            <Select value="" onValueChange={(v: string | null) => v && dais({ op: "addSpeaker", portfolioId: v, motionId })}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder={t("floor.addSpeaker")} />
              </SelectTrigger>
              <SelectContent>
                {seats.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : mineQueued ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => delegate({ op: "withdrawRequest", motionId })}>
            {t("floor.withdrawRequest")}
          </Button>
        ) : !mineLive ? (
          <Button size="sm" disabled={pending} onClick={() => delegate({ op: "requestToSpeak", motionId })}>
            {t("floor.requestToSpeak")}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <section className="space-y-6 rounded-lg border border-border/70 p-4">
      <h2 className="text-lg font-semibold">{t("floor.title")}</h2>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {floor.caucus && (
        <div className="space-y-3 rounded-md border border-primary/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("floor.caucus")}</p>
              <p className="font-medium">
                {KIND_LABEL[floor.caucus.kind]}
                {floor.caucus.topic ? `: ${floor.caucus.topic}` : ""}
              </p>
            </div>
            {floor.caucus.clock && <p className="font-mono text-2xl tabular-nums">{clockText(floor.caucus.clock)}</p>}
            {mode === "dais" && (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={pending}
                  onClick={() => dais({ op: floor.caucus!.clock?.pausedAt ? "resumeCaucus" : "pauseCaucus", motionId: floor.caucus!.id })}>
                  {floor.caucus.clock?.pausedAt ? t("floor.resume") : t("floor.pause")}
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => dais({ op: "endCaucus", motionId: floor.caucus!.id })}>
                  {t("floor.endCaucus")}
                </Button>
              </div>
            )}
          </div>
          {floor.caucus.kind === "MODERATED_CAUCUS" && renderList(floor.caucus.speakers, floor.caucus.id)}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">{t("floor.gsl")}</h3>
          <GslTime seconds={floor.session.gslSpeakingSeconds} editable={mode === "dais"} disabled={pending}
            onSet={(seconds) => dais({ op: "setGslTime", seconds })} />
        </div>
        {renderList(floor.gsl, null)}
      </div>

      <Motions floor={floor} mode={mode} pending={pending} dais={dais} delegate={delegate} />

      <VotePanel floor={floor} mode={mode} pending={pending} dais={dais} delegate={delegate} />
    </section>
  )
}

function GslTime({ seconds, editable, disabled, onSet }: { seconds: number; editable: boolean; disabled: boolean; onSet: (s: number) => void }) {
  const [value, setValue] = useState(String(seconds))
  useEffect(() => setValue(String(seconds)), [seconds])
  if (!editable) return <span className="text-xs text-muted-foreground">{t("floor.gslTime", { s: seconds })}</span>
  return (
    <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); onSet(Number(value)) }}>
      <Input className="w-20" type="number" min={15} max={600} value={value} onChange={(e) => setValue(e.target.value)} />
      <Button size="sm" variant="outline" type="submit" disabled={disabled}>{t("floor.setGslTime")}</Button>
    </form>
  )
}

function Motions({ floor, mode, pending, dais, delegate }: {
  floor: FloorView
  mode: "delegate" | "dais"
  pending: boolean
  dais: (op: DaisOp) => void
  delegate: (op: DelegateOp) => void
}) {
  return (
    <div className="space-y-3">
      <h3 className="font-medium">{t("floor.motions")}</h3>
      {floor.motions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("floor.noMotions")}</p>
      ) : (
        <ul className="space-y-2">
          {floor.motions.map((m: MotionView) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 p-2 text-sm">
              <div>
                <p className="font-medium">
                  {KIND_LABEL[m.kind]}
                  {m.topic ? `: ${m.topic}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("floor.by", { name: m.proposerLabel })}
                  {m.totalSeconds ? ` · ${t("floor.minutes", { n: Math.round(m.totalSeconds / 60) })}` : ""}
                  {m.speakingSeconds ? ` · ${t("floor.gslTime", { s: m.speakingSeconds })}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Badge variant="outline">{STATE_LABEL[m.state] ?? m.state}</Badge>
                {mode === "dais" && m.state === "PROPOSED" && (
                  <>
                    <Button size="sm" disabled={pending} onClick={() => dais({ op: "putToVote", motionId: m.id })}>{t("floor.putToVote")}</Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => dais({ op: "ruleOut", motionId: m.id })}>{t("floor.ruleOut")}</Button>
                  </>
                )}
                {mode === "dais" && m.state === "PASSED" && (m.kind === "MODERATED_CAUCUS" || m.kind === "UNMODERATED_CAUCUS") && (
                  <Button size="sm" disabled={pending || !!floor.caucus} onClick={() => dais({ op: "startCaucus", motionId: m.id })}>{t("floor.startCaucus")}</Button>
                )}
                {mode === "delegate" && m.mine && m.state === "PROPOSED" && (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => delegate({ op: "withdrawMotion", motionId: m.id })}>{t("floor.withdraw")}</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <MotionForm
        label={mode === "dais" ? t("floor.raiseMotion") : t("floor.proposeMotion")}
        disabled={pending}
        onSubmit={(draft) => (mode === "dais" ? dais({ op: "raiseMotion", draft }) : delegate({ op: "proposeMotion", draft }))}
      />
    </div>
  )
}

function MotionForm({ label, disabled, onSubmit }: {
  label: string
  disabled: boolean
  onSubmit: (draft: { kind: MotionKindName; topic: string | null; totalSeconds: number | null; speakingSeconds: number | null }) => void
}) {
  const [kind, setKind] = useState<MotionKindName>("MODERATED_CAUCUS")
  const [topic, setTopic] = useState("")
  const [minutes, setMinutes] = useState("10")
  const [speaking, setSpeaking] = useState("60")
  const needsTopic = kind === "MODERATED_CAUCUS" || kind === "OTHER"
  const needsTime = kind === "MODERATED_CAUCUS" || kind === "UNMODERATED_CAUCUS" || kind === "EXTEND"
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        // The server validates every field again; this only shapes the request.
        onSubmit({
          kind,
          topic: needsTopic ? topic : null,
          totalSeconds: needsTime ? Math.round(Number(minutes) * 60) : null,
          speakingSeconds: kind === "MODERATED_CAUCUS" ? Number(speaking) : null,
        })
        setTopic("")
      }}
    >
      <label className="space-y-1 text-xs">
        <span className="text-muted-foreground">{t("floor.motionKind")}</span>
        <Select value={kind} onValueChange={(v: string | null) => v && setKind(v as MotionKindName)}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(KIND_LABEL) as MotionKindName[]).map((k) => (
              <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {needsTopic && (
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">{t("floor.topic")}</span>
          <Input className="w-56" value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} />
        </label>
      )}
      {needsTime && (
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">{t("floor.totalMinutes")}</span>
          <Input className="w-20" type="number" min={1} max={60} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
      )}
      {kind === "MODERATED_CAUCUS" && (
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">{t("floor.speakingSeconds")}</span>
          <Input className="w-20" type="number" min={15} max={600} value={speaking} onChange={(e) => setSpeaking(e.target.value)} />
        </label>
      )}
      <Button size="sm" type="submit" disabled={disabled}>{label}</Button>
    </form>
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
  const [majority, setMajority] = useState<"SIMPLE" | "TWO_THIRDS">("SIMPLE")
  const v = floor.vote
  const att = floor.me?.attendance ?? null

  const result = (x: VoteView) => (
    <p className="text-sm">
      {t("floor.result", { yes: x.yes ?? 0, no: x.no ?? 0, abstain: x.abstain ?? 0 })}{" "}
      {x.passed !== null && <Badge variant={x.passed ? "default" : "destructive"}>{x.passed ? t("floor.passed") : t("floor.failed")}</Badge>}
    </p>
  )

  return (
    <div className="space-y-3">
      <h3 className="font-medium">{t("floor.vote")}</h3>
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
          ) : !att || !isPresent(att) ? (
            <p className="text-sm text-muted-foreground">{t("floor.notPresentNote")}</p>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                {(["YES", "NO", "ABSTAIN"] as const).map((c) => {
                  const blocked = c === "ABSTAIN" && (v.kind === "PROCEDURAL" || !mayAbstain(att))
                  return (
                    <Button key={c} size="sm" variant={c === "YES" ? "default" : "outline"} disabled={pending || blocked}
                      onClick={() => delegate({ op: "castBallot", voteId: v.id, choice: c })}>
                      {CHOICE_LABEL[c]}
                    </Button>
                  )
                })}
              </div>
              {v.kind === "PROCEDURAL" ? (
                <p className="text-xs text-muted-foreground">{t("floor.proceduralNote")}</p>
              ) : !mayAbstain(att) ? (
                <p className="text-xs text-muted-foreground">{t("floor.votingNote")}</p>
              ) : null}
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
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); dais({ op: "openVote", subject, majority }); setSubject("") }}>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">{t("floor.subject")}</span>
            <Input className="w-64" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <Select value={majority} onValueChange={(v: string | null) => v && setMajority(v as "SIMPLE" | "TWO_THIRDS")}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="SIMPLE">{t("floor.majoritySimple")}</SelectItem>
              <SelectItem value="TWO_THIRDS">{t("floor.majorityTwoThirds")}</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" type="submit" disabled={pending || !subject.trim()}>{t("floor.open")}</Button>
        </form>
      )}
    </div>
  )
}
