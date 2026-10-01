"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { t } from "@/content/strings"
import { formatTime } from "@/lib/datetime"
import { useRealtime } from "@/lib/realtime/client"
import { useVisiblePoll } from "@/lib/use-visible-poll"
import {
  MAX_BODY,
  mergeMessages,
  newestPerKey,
  unreadCounts,
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

// The unread counter a view clears by being open; see unreadKey.
function viewKey(view: View): string | null {
  switch (view.kind) {
    case "floor":
      return "floor"
    case "dais":
      return "dais"
    case "direct":
      return view.with ? `direct:${view.with}` : null
    case "thread":
      return view.with ? `thread:${view.with}` : null
    default:
      return null
  }
}

const sumPrefix = (counts: Record<string, number>, prefix: string) =>
  Object.entries(counts).reduce((n, [k, v]) => (k.startsWith(prefix) ? n + v : n), 0)

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

  // Unread counts. What this browser has seen is kept in localStorage, so a
  // message that arrived while the tab was closed still shows as new. On a first
  // visit everything already there counts as read, rather than greeting a
  // delegate with a wall of badges.
  const seenStore = `committee-chat-seen:${mode}:${committeeId}`
  const [seen, setSeen] = useState<Record<string, number>>({})
  const seenReady = useRef<"load" | "baseline" | "ready">("load")

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
    // A first visit takes its baseline from what the first successful load
    // returns, read straight from the response rather than from state, so no
    // render or effect ordering can hand it an empty list.
    const baseline = seenReady.current === "baseline"
    const loadedNow: MessageView[] = []
    let ok = false
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
        loadedNow.push(...page.messages)
        ok = true
        s.cursor = page.cursor
        s.mod = page.modCursor
        if (page.more) s.again = true
      } while (s.again)
    } catch {
      // Offline or mid-deploy. The next nudge, reconnect or poll tries again.
    } finally {
      s.busy = false
      // Only a load that worked sets the baseline; a failed one leaves it for the
      // next attempt instead of marking nothing as seen.
      if (baseline && ok && seenReady.current === "baseline") {
        seenReady.current = "ready"
        setSeen((prev) => ({ ...newestPerKey(loadedNow, mode), ...prev }))
      }
    }
  }, [committeeId, mode])

  useEffect(() => {
    let stored: Record<string, number> | null = null
    try {
      const raw = localStorage.getItem(seenStore)
      if (raw) stored = JSON.parse(raw) as Record<string, number>
    } catch {
      // Private mode or blocked storage: counts still work for this visit.
    }
    setSeen(stored ?? {})
    seenReady.current = stored ? "ready" : "baseline"
    sync.current = { cursor: null, mod: null, busy: false, again: false, last: 0 }
    setMessages([])
    void refresh()
  }, [refresh, seenStore])

  useEffect(() => {
    if (seenReady.current !== "ready") return
    try {
      localStorage.setItem(seenStore, JSON.stringify(seen))
    } catch {
      // Not persisted; harmless.
    }
  }, [seen, seenStore])

  useRealtime<null>(`committee:${committeeId}`, {
    event: "chat",
    onEvent: () => void refresh(),
    // A reconnect means nudges may have been missed while the phone slept.
    onOpen: () => void refresh(),
  })
  useVisiblePoll(POLL_MS, () => void refresh())

  const shown = useMemo(() => messages.filter((m) => inView(m, view)), [messages, view])
  const unread = useMemo(() => unreadCounts(messages, mode, seen), [messages, mode, seen])
  const heldCount = useMemo(() => messages.filter((m) => m.state === "HELD").length, [messages])

  // Whatever is on screen has been seen.
  useEffect(() => {
    const key = viewKey(view)
    if (!key || shown.length === 0) return
    const newest = shown[shown.length - 1].id
    setSeen((prev) => ((prev[key] ?? 0) >= newest ? prev : { ...prev, [key]: newest }))
  }, [shown, view])
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

  // The sidebar, Slack-style: every conversation is one row with its own unread
  // count, so nobody has to open a picker to find out who wrote to them.
  type Row = { key: string; label: string; view: View; count: number; channel?: boolean }
  const seatRow = (kind: "direct" | "thread", s: Seat): Row => ({
    key: `${kind}:${s.id}`,
    label: s.name,
    view: { kind, with: s.id },
    count: unread[`${kind}:${s.id}`] ?? 0,
  })
  const sections: { title: string; rows: Row[] }[] =
    mode === "delegate"
      ? [
          {
            title: t("committeeChat.channels"),
            rows: [
              { key: "floor", label: t("committeeChat.viewFloor"), view: { kind: "floor" }, count: unread.floor ?? 0, channel: true },
              { key: "dais", label: t("committeeChat.viewDais"), view: { kind: "dais" }, count: unread.dais ?? 0, channel: true },
            ],
          },
          { title: t("committeeChat.directMessages"), rows: seats.map((s) => seatRow("direct", s)) },
        ]
      : [
          {
            title: t("committeeChat.channels"),
            rows: [{ key: "floor", label: t("committeeChat.viewFloor"), view: { kind: "floor" }, count: unread.floor ?? 0, channel: true }],
          },
          { title: t("committeeChat.viewThreads"), rows: seats.map((s) => seatRow("thread", s)) },
          {
            title: t("committeeChat.oversight"),
            rows: [
              { key: "allDirect", label: t("committeeChat.viewAllDirect"), view: { kind: "allDirect" }, count: 0 },
              { key: "held", label: t("committeeChat.viewHeld"), view: { kind: "held" }, count: heldCount },
            ],
          },
        ]
  const currentKey = viewKey(view) ?? view.kind
  const current = sections.flatMap((x) => x.rows).find((r) => r.key === currentKey)

  const placeholder =
    view.kind === "floor"
      ? t("committeeChat.placeholderFloor")
      : view.kind === "dais"
        ? t("committeeChat.placeholderDais")
        : view.kind === "direct"
          ? t("committeeChat.placeholderDirect", { name: seatName(view.with) })
          : t("committeeChat.placeholderReply", { name: seatName(view.kind === "thread" ? view.with : null) })

  return (
    <section className="grid overflow-hidden rounded-lg border border-border/70 md:grid-cols-[13rem_minmax(0,1fr)]">
      <nav aria-label={t("committeeChat.title")} className="space-y-4 border-b border-border/70 bg-muted/30 p-3 md:border-b-0 md:border-r">
        {sections.map((section) => (
          <div key={section.title} className="space-y-1">
            <p className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</p>
            <ul className="space-y-0.5">
              {section.rows.map((row) => (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => setView(row.view)}
                    aria-current={row.key === currentKey ? "true" : undefined}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm ${row.key === currentKey ? "bg-primary/10 font-medium" : row.count > 0 ? "font-semibold hover:bg-muted" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    <span className="truncate">{row.channel ? `# ${row.label}` : row.label}</span>
                    <UnreadBadge n={row.count} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex min-w-0 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{current ? (current.channel ? `# ${current.label}` : current.label) : t("committeeChat.title")}</h2>
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

        <div className="h-[24rem] space-y-3 overflow-y-auto rounded-md bg-muted/30 p-3">
          {shown.length === 0 ? (
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
      </div>
    </section>
  )
}

function UnreadBadge({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <Badge variant="secondary" className="ml-1.5 tabular-nums" aria-label={t("committeeChat.unread", { n })}>
      {n}
    </Badge>
  )
}
