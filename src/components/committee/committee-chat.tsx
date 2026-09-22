"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { t } from "@/content/strings"
import { formatTime } from "@/lib/datetime"
import { useRealtime } from "@/lib/realtime/client"
import { useVisiblePoll } from "@/lib/use-visible-poll"
import {
  MAX_BODY,
  mergeMessages,
  type Draft,
  type MessageView,
  type ModerationAction,
} from "@/lib/committee/chat"
import type { MessagesPage, SendResult } from "@/lib/committee/messages"

// Committee chat for both sides of the room. Correctness never depends on the
// realtime channel: a nudge, a reconnect and a slow poll all run the same fetch,
// which asks the server what this account may see since its last cursor. A
// missed nudge costs at most one poll interval, never a message.

// ponytail: reads are not rate limited on the server; the client caps itself at
// two a second. Add a server-side read limit if a hostile seated delegate ever
// matters more than the extra DB write per read would cost.
const MIN_GAP_MS = 500
const POLL_MS = 60_000

export interface Seat {
  id: string
  name: string
}

type View =
  | { kind: "floor" }
  | { kind: "dais" }
  | { kind: "direct"; with: string | null }
  | { kind: "thread"; with: string | null }
  | { kind: "allDirect" }
  | { kind: "held" }

interface Props {
  committeeId: string
  mode: "delegate" | "dais"
  /** Other allotted seats: DM recipients for a delegate, threads for the dais. */
  seats: Seat[]
  holdDirectMessages: boolean
  send: (committeeId: string, draft: Draft) => Promise<SendResult>
  moderate?: (committeeId: string, messageId: number, action: ModerationAction) => Promise<{ success: boolean; error?: string }>
  setHold?: (committeeId: string, on: boolean) => Promise<{ success: boolean; error?: string }>
}

function inView(m: MessageView, view: View): boolean {
  switch (view.kind) {
    case "floor":
      return m.scope === "FLOOR"
    case "dais":
      return m.scope === "EB"
    case "direct":
      return m.scope === "DM" && !!view.with && (m.fromPortfolioId === view.with || m.toPortfolioId === view.with)
    case "thread":
      return m.scope === "EB" && !!view.with && (m.fromPortfolioId === view.with || m.toPortfolioId === view.with)
    case "allDirect":
      return m.scope === "DM"
    case "held":
      return m.state === "HELD"
  }
}

function draftFor(view: View): Omit<Draft, "body"> | null {
  switch (view.kind) {
    case "floor":
      return { scope: "FLOOR", toPortfolioId: null }
    case "dais":
      return { scope: "EB", toPortfolioId: null }
    case "direct":
      return view.with ? { scope: "DM", toPortfolioId: view.with } : null
    case "thread":
      return view.with ? { scope: "EB", toPortfolioId: view.with } : null
    default:
      return null
  }
}

export function CommitteeChat({ committeeId, mode, seats, holdDirectMessages, send, moderate, setHold }: Props) {
  const [messages, setMessages] = useState<MessageView[]>([])
  const [view, setView] = useState<View>({ kind: "floor" })
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [hold, setHoldState] = useState(holdDirectMessages)
  const [pending, startTransition] = useTransition()
  const bottom = useRef<HTMLDivElement>(null)

  // Fetch state lives in a ref: it must survive renders without causing them, and
  // the single-flight guard has to see the latest value synchronously.
  const sync = useRef({ cursor: null as number | null, mod: null as string | null, busy: false, again: false, last: 0 })

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
        const wait = s.last + MIN_GAP_MS - Date.now()
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        s.last = Date.now()
        const q = new URLSearchParams()
        if (s.cursor !== null) q.set("since", String(s.cursor))
        if (s.mod) q.set("mod", s.mod)
        const res = await fetch(`/api/committee/${committeeId}/messages?${q}`, { cache: "no-store" })
        if (!res.ok) break
        const page = (await res.json()) as MessagesPage
        setMessages((prev) => mergeMessages(prev, page.messages, page.removed))
        s.cursor = page.cursor
        s.mod = page.modCursor
        if (page.more) s.again = true
      } while (s.again)
    } catch {
      // Offline or mid-deploy. The next nudge, reconnect or poll tries again.
    } finally {
      s.busy = false
    }
  }, [committeeId])

  useEffect(() => {
    sync.current = { cursor: null, mod: null, busy: false, again: false, last: 0 }
    setMessages([])
    void refresh()
  }, [refresh])

  useRealtime<null>(`committee:${committeeId}`, {
    event: "chat",
    onEvent: () => void refresh(),
    // A reconnect means nudges may have been missed while the phone slept.
    onOpen: () => void refresh(),
  })
  useVisiblePoll(POLL_MS, () => void refresh())

  const shown = useMemo(() => messages.filter((m) => inView(m, view)), [messages, view])
  const target = draftFor(view)
  const seatName = (id: string | null) => seats.find((s) => s.id === id)?.name ?? ""

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" })
  }, [shown.length, view])

  const submit = () => {
    if (!target || !body.trim() || pending) return
    setError(null)
    const draft: Draft = { ...target, body }
    startTransition(async () => {
      try {
        const res = await send(committeeId, draft)
        if (!res.success) {
          setError(res.error)
          return
        }
        setBody("")
        setMessages((prev) => mergeMessages(prev, [res.message]))
      } catch {
        setError(t("committeeChat.errorNetwork"))
      }
    })
  }

  const act = (id: number, action: ModerationAction) => {
    if (!moderate) return
    setError(null)
    startTransition(async () => {
      const res = await moderate(committeeId, id, action)
      if (!res.success) setError(res.error ?? null)
      await refresh()
    })
  }

  const toggleHold = (on: boolean) => {
    if (!setHold) return
    setHoldState(on)
    startTransition(async () => {
      const res = await setHold(committeeId, on)
      if (!res.success) {
        setHoldState(!on)
        setError(res.error ?? null)
      }
    })
  }

  const picker = (current: string | null, kind: "direct" | "thread") => (
    <Select
      value={current ?? undefined}
      onValueChange={(v: string | null) => {
        if (v) setView({ kind, with: v })
      }}
    >
      <SelectTrigger className="w-60">
        <SelectValue placeholder={t("committeeChat.pickDelegation")} />
      </SelectTrigger>
      <SelectContent>
        {seats.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  const tabs: { label: string; view: View; active: boolean }[] =
    mode === "delegate"
      ? [
          { label: t("committeeChat.viewFloor"), view: { kind: "floor" }, active: view.kind === "floor" },
          { label: t("committeeChat.viewDais"), view: { kind: "dais" }, active: view.kind === "dais" },
          { label: t("committeeChat.viewDirect"), view: { kind: "direct", with: null }, active: view.kind === "direct" },
        ]
      : [
          { label: t("committeeChat.viewFloor"), view: { kind: "floor" }, active: view.kind === "floor" },
          { label: t("committeeChat.viewThreads"), view: { kind: "thread", with: null }, active: view.kind === "thread" },
          { label: t("committeeChat.viewAllDirect"), view: { kind: "allDirect" }, active: view.kind === "allDirect" },
          { label: t("committeeChat.viewHeld"), view: { kind: "held" }, active: view.kind === "held" },
        ]

  const placeholder =
    view.kind === "floor"
      ? t("committeeChat.placeholderFloor")
      : view.kind === "dais"
        ? t("committeeChat.placeholderDais")
        : view.kind === "direct"
          ? t("committeeChat.placeholderDirect", { name: seatName(view.with) })
          : t("committeeChat.placeholderReply", { name: seatName(view.kind === "thread" ? view.with : null) })

  return (
    <section className="space-y-4 rounded-lg border border-border/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("committeeChat.title")}</h2>
        {mode === "dais" && setHold && (
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={hold} onCheckedChange={(v: boolean) => toggleHold(v)} disabled={pending} />
            {t("committeeChat.holdLabel")}
          </label>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {mode === "delegate"
          ? t("committeeChat.daisSeesAll")
          : hold
            ? t("committeeChat.holdOn")
            : t("committeeChat.holdOff")}
        {mode === "delegate" && holdDirectMessages ? ` ${t("committeeChat.delegateHoldOn")}` : ""}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab.label}
            size="sm"
            variant={tab.active ? "default" : "outline"}
            onClick={() => setView(tab.view)}
          >
            {tab.label}
          </Button>
        ))}
        {view.kind === "direct" && picker(view.with, "direct")}
        {view.kind === "thread" && picker(view.with, "thread")}
      </div>

      <div className="max-h-[28rem] min-h-40 space-y-3 overflow-y-auto rounded-md bg-muted/30 p-3">
        {(view.kind === "direct" || view.kind === "thread") && !view.with ? (
          <p className="text-sm text-muted-foreground">{t("committeeChat.pickFirst")}</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("committeeChat.empty")}</p>
        ) : (
          shown.map((m) => (
            <article key={m.id} className={m.mine ? "ml-8 space-y-1" : "mr-8 space-y-1"}>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{m.fromLabel}</span>
                {m.scope !== "FLOOR" && m.toLabel && <span>{t("committeeChat.to", { name: m.toLabel })}</span>}
                <span>{formatTime(m.createdAt)}</span>
                {m.state === "HELD" && <Badge variant="outline">{t("committeeChat.held")}</Badge>}
                {m.state === "BLOCKED" && <Badge variant="destructive">{t("committeeChat.blocked")}</Badge>}
              </p>
              <p className="whitespace-pre-wrap break-words rounded-md bg-background px-3 py-2 text-sm">{m.body}</p>
              {mode === "dais" && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {m.authorEmail && <span>{t("committeeChat.typedBy", { email: m.authorEmail })}</span>}
                  {m.state === "HELD" && (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => act(m.id, "approve")}>
                      {t("committeeChat.approve")}
                    </Button>
                  )}
                  {m.state !== "BLOCKED" ? (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(m.id, "block")}>
                      {t("committeeChat.block")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(m.id, "restore")}>
                      {t("committeeChat.restore")}
                    </Button>
                  )}
                </div>
              )}
            </article>
          ))
        )}
        <div ref={bottom} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {target ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Textarea
            value={body}
            maxLength={MAX_BODY}
            rows={2}
            placeholder={placeholder}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter is a new line, as in every chat app.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {t("committeeChat.counter", { n: body.length, max: MAX_BODY })}
            </span>
            <Button type="submit" disabled={pending || !body.trim()}>
              {pending ? t("committeeChat.sending") : t("committeeChat.send")}
            </Button>
          </div>
        </form>
      ) : (
        view.kind === "allDirect" || view.kind === "held" ? (
          <p className="text-xs text-muted-foreground">{t("committeeChat.readOnly")}</p>
        ) : null
      )}
    </section>
  )
}
