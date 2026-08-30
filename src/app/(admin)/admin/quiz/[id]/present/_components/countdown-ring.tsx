"use client"

import { useEffect, useState, useRef } from "react"

interface Props {
  durationSeconds: number
  running: boolean
  accentColor: string
  trackColor?: string
  onExpire?: () => void
}

export function CountdownRing({ durationSeconds, running, accentColor,
  // Derived from the theme by the caller: the ring used to hardcode a white
  // track, invisible on the light preset themes.
  trackColor = "rgba(128,128,128,0.25)", onExpire }: Props) {
  const [remaining, setRemaining] = useState(durationSeconds)
  const startRef = useRef<number | null>(null)
  const rafRef = useRef<number | undefined>(undefined)
  const expiredRef = useRef(false)

  useEffect(() => {
    setRemaining(durationSeconds)
    expiredRef.current = false
    startRef.current = null
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
  }, [durationSeconds])

  useEffect(() => {
    if (!running) {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      return
    }

    if (startRef.current === null) startRef.current = Date.now()

    // Returns false once the question has expired, so both drivers stop.
    function update(): boolean {
      const elapsed = (Date.now() - (startRef.current ?? Date.now())) / 1000
      const left = Math.max(0, durationSeconds - elapsed)
      setRemaining(left)
      if (left > 0) return true
      if (!expiredRef.current) {
        expiredRef.current = true
        onExpire?.()
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
  }, [running, durationSeconds, onExpire])

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
