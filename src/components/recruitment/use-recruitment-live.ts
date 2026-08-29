"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { getSupabase } from "@/lib/supabase"

// Realtime for the recruitment surfaces.
//
// Deliberately BROADCAST, not `postgres_changes`. The availability boards subscribe
// to row changes, which is fine for public portfolio counts, but any client holding
// the publishable key can subscribe to the same stream, and candidate rows are not
// public. So the payload here is a topic string only; the actual data is re-fetched
// through `router.refresh()`, which goes back through the server guards.
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
  const channelRef = useRef<ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null>(null)

  useEffect(() => {
    if (!cycleId) return

    // Realtime is a progressive enhancement: when it is unconfigured the polling
    // fallback below still keeps the screen current, so this must not bail out.
    const supabase = getSupabase()
    const channel = supabase
      ? supabase
          .channel(`recruitment:${cycleId}`)
          .on("broadcast", { event: "changed" }, () => {
            router.refresh()
          })
          .subscribe()
      : null
    channelRef.current = channel

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
      if (supabase && channel) void supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [cycleId, pollMs, router])

  // Called after a successful mutation so other viewers refresh promptly. Carries
  // no candidate data: just a nudge to re-fetch through the guards.
  const notify = (topic: RecruitmentTopic) => {
    void channelRef.current?.send({ type: "broadcast", event: "changed", payload: { topic } })
  }

  return { notify }
}
