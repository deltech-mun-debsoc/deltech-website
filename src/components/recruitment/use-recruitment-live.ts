"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { publish, useRealtime } from "@/lib/realtime/client"

// Realtime for the recruitment surfaces.
//
// The payload is a topic string only; the actual data is re-fetched through
// `router.refresh()`, which goes back through the server guards. Since the move
// off Supabase the channel itself is signed-in only (src/lib/realtime/channels.ts),
// but the rule stands: candidate data never travels on the bus.
//
// A polling floor backs it up, so a dropped socket degrades to a slow update rather
// than a stuck screen.
export type RecruitmentTopic = "session" | "candidate" | "import" | "evaluation"

// The safety net, not the update mechanism. Realtime pushes a refresh the moment
// anything changes, and returning to the tab refreshes too, so this only has to
// cover the case where realtime is unconfigured or its socket died silently.
//
// It used to be 10-30s per screen, which meant a full RSC render and database round
// trip every few seconds per open tab, forever, whether or not anything had changed.
const FALLBACK_POLL_MS = 5 * 60 * 1000

export function useRecruitmentLive(
  cycleId: string | null,
  { pollMs = FALLBACK_POLL_MS }: { pollMs?: number } = {},
): { notify: (topic: RecruitmentTopic) => void } {
  const router = useRouter()

  useRealtime<{ topic: RecruitmentTopic }>(cycleId ? `recruitment:${cycleId}` : null, {
    event: "changed",
    onEvent: () => router.refresh(),
  })

  useEffect(() => {
    if (!cycleId) return

    // Fallback only, and deliberately slow. A hidden tab polls nothing: it will
    // refresh on visibilitychange the moment someone looks at it again.
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh()
    }, pollMs)

    // Returning to a backgrounded tab should show current state at once, rather
    // than whatever was on screen when it was hidden.
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh()
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [cycleId, pollMs, router])

  // Called after a successful mutation so other viewers refresh promptly. Carries
  // no candidate data: just a nudge to re-fetch through the guards.
  const notify = (topic: RecruitmentTopic) => {
    if (!cycleId) return
    void publish(`recruitment:${cycleId}`, "changed", { topic })
  }

  return { notify }
}
