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

export function useRecruitmentLive(
  cycleId: string | null,
  { pollMs = 15000 }: { pollMs?: number } = {},
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

    // Fallback: refresh on a slow cadence regardless. Costs one RSC request per
    // interval and guarantees a screen is never more than pollMs stale.
    const interval = setInterval(() => router.refresh(), pollMs)

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
