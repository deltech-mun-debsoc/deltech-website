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

/**
 * Subscribe while `channel` is non-null. Handlers are held in a ref, so a parent
 * re-render does not tear the connection down and re-join the room.
 */
export function useRealtime<T>(
  channel: string | null,
  handlers: RealtimeHandlers<T>,
  identity?: PresenceIdentity | null,
): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const identityKey = identity ? `${identity.userId}|${identity.nickname}|${identity.avatar}` : ""

  useEffect(() => {
    if (!channel) return
    const parsed: PresenceIdentity | null = identityKey
      ? (() => {
          const [userId, nickname, avatar] = identityKey.split("|")
          return { userId, nickname, avatar }
        })()
      : null

    const source = new EventSource(realtimeUrl(channel, parsed))
    source.addEventListener("ready", () => handlersRef.current.onOpen?.())
    source.addEventListener("presence", (e) => {
      try {
        handlersRef.current.onPresence?.(JSON.parse((e as MessageEvent).data))
      } catch {
        // Malformed frame: skip it rather than kill the stream.
      }
    })
    source.addEventListener(handlersRef.current.event ?? "message", (e) => {
      try {
        handlersRef.current.onEvent?.(JSON.parse((e as MessageEvent).data))
      } catch {
        // Same.
      }
    })

    return () => source.close()
  }, [channel, identityKey])
}
