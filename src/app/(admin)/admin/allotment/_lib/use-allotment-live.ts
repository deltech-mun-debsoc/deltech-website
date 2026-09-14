"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { publish, useRealtime } from "@/lib/realtime/client"

// Keeps every open allotment board current while several organisers allot at
// once. Before this, a board only changed after its own mutation, so two people
// at the desk could both pick a seat the other had just given away, and learn
// about it from an "already allotted" error.
//
// Same rule as the recruitment screens: the payload is a nudge, never data. A
// refresh goes back through requireStaff() and fetches seat state properly, and
// the channel is staff-only in both directions (src/lib/realtime/channels.ts).
//
// Mutations from other screens, such as removing a delegate from the
// registrations drawer, do not publish here. The slow poll and the refresh on
// returning to the tab cover those.
const FALLBACK_POLL_MS = 60 * 1000

export function useAllotmentLive(eventId: string | null): { notify: () => void } {
  const router = useRouter()

  useRealtime<{ topic: "allotment" }>(eventId ? `allotment:${eventId}` : null, {
    event: "changed",
    onEvent: () => router.refresh(),
  })

  useEffect(() => {
    if (!eventId) return
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh()
    }, FALLBACK_POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [eventId, router])

  const notify = () => {
    if (!eventId) return
    void publish(`allotment:${eventId}`, "changed", { topic: "allotment" })
  }

  return { notify }
}
