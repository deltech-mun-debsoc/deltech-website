"use client"

import { useEffect, useRef } from "react"

// The browser half of the realtime bus (src/lib/realtime/bus.ts).
//
// EventSource rather than a WebSocket: the traffic is one-directional (the room
// is driven by the host, the recruitment screens by whoever just saved), it
// reconnects by itself, and it survives a phone locking and waking. Publishing
// goes over ordinary POST, where the session cookie is checked.

export interface PresenceMeta {
  nickname: string
  avatar: string
  userId: string
}

export interface RealtimeHandlers<T> {
  /** SSE event name the publisher uses ("quiz", "changed"). */
  event?: string
  onEvent?: (payload: T) => void
  onPresence?: (members: PresenceMeta[]) => void
  onOpen?: () => void
}

/** Identify this browser in the room's presence list. */
export interface PresenceIdentity {
  nickname: string
  avatar: string
  userId: string
}

export function realtimeUrl(channel: string, identity?: PresenceIdentity | null): string {
  const params = new URLSearchParams({ channel })
  if (identity) {
    params.set("nickname", identity.nickname)
    params.set("avatar", identity.avatar)
    params.set("userId", identity.userId)
  }
  return `/api/realtime?${params.toString()}`
}

/** Publish one event. Refused unless the session is allowed on that channel. */
export async function publish(channel: string, event: string, payload: unknown): Promise<void> {
  try {
    await fetch("/api/realtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, event, payload }),
      keepalive: true,
    })
  } catch {
    // A failed nudge must never break the action that triggered it: the poll
    // fallback and the next refresh still bring viewers up to date.
  }
}

// ONE EventSource per channel per tab, reference counted.
//
// Without this, every component that subscribes opens its own connection, and
// the recruitment screens mount the hook once per candidate row: ~100 rows
// became ~100 EventSources, which pegged the tab's main thread hard enough that
// clicking anything did nothing (server actions could never dispatch).
//
// Supabase hid this by multiplexing every channel onto a single WebSocket. The
// bus has to do the multiplexing itself.
export type Listener = { handlers: RealtimeHandlers<unknown> }

interface Shared {
  source: EventSource
  listeners: Set<Listener>
  events: Set<string>
}

const shared = new Map<string, Shared>()

function attach(conn: Shared, event: string): void {
  if (conn.events.has(event)) return
  conn.events.add(event)
  conn.source.addEventListener(event, (e) => {
    let payload: unknown
    try {
      payload = JSON.parse((e as MessageEvent).data)
    } catch {
      return // Malformed frame: skip it rather than kill the stream.
    }
    for (const l of conn.listeners) {
      if ((l.handlers.event ?? "message") === event) l.handlers.onEvent?.(payload)
    }
  })
}

/** Exported so scripts/check-realtime-client.ts can pin the sharing rules. */
export function subscribeShared(key: string, url: string, listener: Listener): () => void {
  let conn = shared.get(key)
  if (!conn) {
    const source = new EventSource(url)
    conn = { source, listeners: new Set(), events: new Set() }
    shared.set(key, conn)
    source.addEventListener("ready", () => {
      for (const l of conn!.listeners) l.handlers.onOpen?.()
    })
    source.addEventListener("presence", (e) => {
      let members: PresenceMeta[]
      try {
        members = JSON.parse((e as MessageEvent).data)
      } catch {
        return
      }
      for (const l of conn!.listeners) l.handlers.onPresence?.(members)
    })
  }
  conn.listeners.add(listener)
  attach(conn, listener.handlers.event ?? "message")

  return () => {
    const current = shared.get(key)
    if (!current) return
    current.listeners.delete(listener)
    // The last component to leave closes the connection.
    if (current.listeners.size === 0) {
      current.source.close()
      shared.delete(key)
    }
  }
}

/**
 * Subscribe while `channel` is non-null. Handlers are held in a ref, so a parent
 * re-render does not tear the connection down and re-join the room. Components
 * sharing a channel share one connection.
 */
export function useRealtime<T>(
  channel: string | null,
  handlers: RealtimeHandlers<T>,
  identity?: PresenceIdentity | null,
): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const identityKey = identity ? `${identity.userId}|${identity.nickname}|${identity.avatar}` : ""
  const eventName = handlers.event ?? "message"

  useEffect(() => {
    if (!channel) return
    const parsed: PresenceIdentity | null = identityKey
      ? (() => {
          const [userId, nickname, avatar] = identityKey.split("|")
          return { userId, nickname, avatar }
        })()
      : null

    // Identity is part of the key: two people in one tab would be two rooms.
    const key = `${channel}|${identityKey}`
    const listener: Listener = {
      get handlers() {
        return handlersRef.current as RealtimeHandlers<unknown>
      },
    }
    return subscribeShared(key, realtimeUrl(channel, parsed), listener)
  }, [channel, identityKey, eventName])
}
