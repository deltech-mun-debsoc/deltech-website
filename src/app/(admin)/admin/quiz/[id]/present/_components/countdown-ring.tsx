"use client"

import { useEffect, useState, useRef } from "react"

interface Props {
  durationSeconds: number
  running: boolean
  accentColor: string
  trackColor?: string
  initialRemainingSeconds?: number | null
  onExpire?: () => void
}

export function CountdownRing({ durationSeconds, running, accentColor,
  // Derived from the theme by the caller: the ring used to hardcode a white
  // track, invisible on the light preset themes.
  trackColor = "rgba(128,128,128,0.25)", initialRemainingSeconds, onExpire }: Props) {
  const initial = Math.min(durationSeconds, initialRemainingSeconds ?? durationSeconds)
  const [remaining, setRemaining] = useState(initial)
  const remainingRef = useRef(initial)
  const rafRef = useRef<number | undefined>(undefined)
  const expiredRef = useRef(false)
  const onExpireRef = useRef(onExpire)

  useEffect(() => { onExpireRef.current = onExpire }, [onExpire])

  useEffect(() => {
    const next = Math.min(durationSeconds, initialRemainingSeconds ?? durationSeconds)
    remainingRef.current = next
    setRemaining(next)
    expiredRef.current = false
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
  }, [durationSeconds, initialRemainingSeconds])

  useEffect(() => {
    if (!running) {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      return
    }

    // Every running period starts from the last visible remainder. Pausing no
    // longer counts as elapsed time, so reopening at 34 seconds resumes at 34
    // instead of expiring immediately because wall time kept moving.
    const runStartedAt = Date.now()
    const runStartedWith = remainingRef.current

    // Returns false once the question has expired, so both drivers stop.
    function update(): boolean {
      const elapsed = (Date.now() - runStartedAt) / 1000
      const left = Math.max(0, runStartedWith - elapsed)
      remainingRef.current = left
      setRemaining(left)
      if (left > 0) return true
      if (!expiredRef.current) {
        expiredRef.current = true
        onExpireRef.current?.()
      }
      return false
    }

    // Two drivers, deliberately. requestAnimationFrame gives the ring a smooth
    // sweep, but the browser stops it entirely while the tab is not visible --
    // so a host who switched away from the projector left the question open
    // forever while every phone's own countdown, which is deadline-based, had
    // already run out. The interval is throttled in a background tab but never
    // stopped, so expiry still fires. Both read the same wall clock, so they
    // cannot disagree about when time is up.
    function frame() {
      if (update()) rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    const interval = setInterval(() => {
      if (!update()) clearInterval(interval)
    }, 500)

    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      clearInterval(interval)
    }
  }, [running, durationSeconds, initialRemainingSeconds])

  const pct = durationSeconds > 0 ? remaining / durationSeconds : 0
  const r = 44
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - pct)
  const secs = Math.ceil(remaining)
  // final-3-seconds urgency: ring and number go red and pulse with each second
  const critical = running && remaining > 0 && remaining <= 3
  const ringColor = critical ? "#ef4444" : accentColor

  return (
    <div
      className={`relative flex items-center justify-center ${critical ? "motion-safe:animate-pulse" : ""}`}
      style={{ width: 112, height: 112 }}
    >
      <svg width={112} height={112} className="-rotate-90">
        <circle cx={56} cy={56} r={r} strokeWidth={8} stroke={trackColor} fill="none" />
        <circle
          cx={56}
          cy={56}
          r={r}
          strokeWidth={8}
          stroke={ringColor}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.1s linear, stroke 0.3s ease" }}
        />
      </svg>
      <span
        className={`absolute font-bold tabular-nums ${critical ? "text-3xl" : "text-2xl"}`}
        style={{ color: ringColor, transition: "color 0.3s ease, font-size 0.2s ease" }}
      >
        {secs}
      </span>
    </div>
  )
}
