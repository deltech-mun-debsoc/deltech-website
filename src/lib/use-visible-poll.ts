"use client"

import { useEffect, useRef } from "react"

// Refresh on a timer, but only while the tab is actually being looked at.
//
// The availability boards used Supabase `postgres_changes`, which only works
// while the database lives on Supabase. A poll is the replacement: seats change
// a few times a minute during allotment, so a 20s lag is invisible to a viewer
// and costs one render per visible tab.
//
// Hidden tabs must not poll. A phone left open on the matrix page for an
// afternoon is otherwise a free render every 20 seconds, for nobody.

/** Pure so scripts/check-visible-poll.ts can pin the rules. */
export function shouldRefresh(args: {
  visible: boolean
  now: number
  lastRun: number
  intervalMs: number
}): boolean {
  if (!args.visible) return false
  return args.now - args.lastRun >= args.intervalMs
}

export function useVisiblePoll(intervalMs: number, run: () => void): void {
  const runRef = useRef(run)
  runRef.current = run

  useEffect(() => {
    let last = Date.now()

    const tick = () => {
      const visible = typeof document === "undefined" || document.visibilityState === "visible"
      if (!shouldRefresh({ visible, now: Date.now(), lastRun: last, intervalMs })) return
      last = Date.now()
      runRef.current()
    }

    const timer = setInterval(tick, Math.min(intervalMs, 5000))
    // Coming back to the tab is the moment staleness is most obvious.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick()
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [intervalMs])
}
