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

    function tick(now: number) {
      if (startRef.current === null) startRef.current = now
      const elapsed = (now - startRef.current) / 1000
      const left = Math.max(0, durationSeconds - elapsed)
      setRemaining(left)
      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true
        onExpire?.()
        return
      }
      if (left > 0) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
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
