"use client"

import { useEffect, useState } from "react"
import { t } from "@/content/strings"

// Points ticking up rather than appearing. Purely presentational, and it settles
// on the real value even if the animation is interrupted.
//
// Respects prefers-reduced-motion by jumping straight to the total: a number
// counting up is exactly the kind of movement that setting exists to stop.
export function CountUp({ to, durationMs = 700 }: { to: number; durationMs?: number }) {
  const [value, setValue] = useState(to)

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    // A hidden tab does not run requestAnimationFrame. Starting from zero there
    // meant a phone that locked, or an app switched away from, at the moment of
    // the reveal came back showing "+0 points" for an answer that had actually
    // scored -- and stayed there, because the frame that would have corrected it
    // never came.
    if (reduced || to <= 0 || document.visibilityState !== "visible") {
      setValue(to)
      return
    }

    setValue(0)
    const start = performance.now()
    let frame = 0

    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1)
      // Ease out: fast at first, settling into the final number.
      setValue(Math.round(to * (1 - Math.pow(1 - progress, 3))))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    // Whatever happens to the frames, the real number is on screen shortly.
    // Timers are throttled in a background tab but they are not stopped.
    const settle = setTimeout(() => setValue(to), durationMs + 150)
    const onHide = () => setValue(to)
    document.addEventListener("visibilitychange", onHide)

    // Land on the exact total if the component unmounts mid-animation.
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(settle)
      document.removeEventListener("visibilitychange", onHide)
      setValue(to)
    }
  }, [to, durationMs])

  return <>{t("quiz.pointsEarned", { points: value })}</>
}
