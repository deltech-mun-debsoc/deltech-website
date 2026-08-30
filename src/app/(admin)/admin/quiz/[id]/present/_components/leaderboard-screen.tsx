"use client"

import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowDown, ArrowUp, Minus, Sparkles, Trophy } from "lucide-react"
import { FALLBACK_AVATAR } from "@/lib/quiz-types"
import { ConfettiBurst } from "./confetti-burst"
import { t } from "@/content/strings"
import type { LBEntry, PresentationTheme } from "@/lib/quiz-types"
import { quizSurface, readableOn } from "@/lib/quiz-theme"

interface Props {
  entries: LBEntry[]
  final: boolean
  theme: PresentationTheme
  onNext?: () => void
  onEnd?: () => void
}

function Movement({ delta }: { delta: number | undefined }) {
  if (delta === undefined) {
    return (
      <span className="flex items-center gap-1 font-mono text-[0.65rem] font-black uppercase tracking-[0.14em] opacity-55">
        <Sparkles className="size-3" /> {t("quiz.joinedBoard")}
      </span>
    )
  }
  if (delta > 0) {
    return (
      <span className="flex items-center gap-1 font-mono text-xs font-black text-emerald-500">
        <ArrowUp className="size-4" /> {delta}
      </span>
    )
  }
  if (delta < 0) {
    return (
      <span className="flex items-center gap-1 font-mono text-xs font-black text-rose-500">
        <ArrowDown className="size-4" /> {Math.abs(delta)}
      </span>
    )
  }
  return <Minus className="size-4 opacity-35" aria-label={t("quiz.heldPosition")} />
}

export function LeaderboardScreen({ entries, final, theme, onNext, onEnd }: Props) {
  const surface = quizSurface(theme)
  const reduce = useReducedMotion()
  const top = entries.slice(0, 10)
  const maxScore = Math.max(...top.map((entry) => entry.totalPoints), 1)

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden px-8 py-7"
      style={{ background: theme.background, color: theme.textColor }}
    >
      <div className="paper-grid pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden />
      <div
        className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full border opacity-25"
        style={{ borderColor: theme.accentColor }}
        aria-hidden
      />
      <ConfettiBurst active={final} />

      <header className="relative mb-5 flex items-end justify-between border-b pb-4" style={{ borderColor: surface.border }}>
        <div>
          <p className="mb-2 flex items-center gap-2 font-mono text-xs font-black uppercase tracking-[0.22em] opacity-55">
            <span className="size-2 animate-pulse" style={{ background: theme.accentColor }} />
            {final ? t("quiz.finalResults") : t("quiz.liveStandings")}
          </p>
          <h1 className="font-heading text-[clamp(3.25rem,6vw,6rem)] leading-[0.82] tracking-[-0.045em]">
            {final ? t("quiz.finalResults") : t("quiz.leaderboard")}
          </h1>
        </div>
        {final && top[0] && (
          <motion.div
            initial={reduce ? false : { scale: 0.75, opacity: 0, rotate: -5 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 17, delay: 0.2 }}
            className="flex items-center gap-3 border px-5 py-3"
            style={{ borderColor: theme.accentColor, background: `${theme.accentColor}18` }}
          >
            <Trophy className="size-7" style={{ color: theme.accentColor }} />
            <div>
              <p className="font-mono text-[0.65rem] font-black uppercase tracking-[0.16em] opacity-55">#1</p>
              <p className="max-w-52 truncate font-heading text-2xl">{top[0].nickname}</p>
            </div>
          </motion.div>
        )}
      </header>

      <div className="relative min-h-0 flex-1 space-y-2 overflow-hidden">
        <AnimatePresence initial={false}>
          {top.map((entry, index) => {
            const width = Math.max(7, (entry.totalPoints / maxScore) * 100)
            return (
              <motion.div
                key={entry.nickname}
                layout
                // The board is intentionally shown between questions, so the
                // previous rows are no longer mounted for layout animation to
                // interpolate from. Start each row at its prior rank instead:
                // a +2 visibly travels up two row-heights.
                initial={reduce ? false : { y: entry.delta === undefined ? 20 : entry.delta * 56, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={reduce ? undefined : { y: -20, opacity: 0 }}
                transition={{ layout: { type: "spring", stiffness: 210, damping: 24 }, delay: reduce ? 0 : index * 0.045 }}
                className="grid grid-cols-[3rem_1fr_6.5rem] items-center gap-3"
              >
                <span className="text-right font-mono text-lg font-black tabular-nums opacity-55">
                  {t("quiz.rankN", { n: entry.rank })}
                </span>

                <div className="relative h-12 overflow-hidden" style={{ background: surface.track }}>
                  <motion.div
                    className="absolute inset-y-0 left-0"
                    initial={reduce ? false : { width: 0 }}
                    animate={{ width: `${width}%` }}
                    transition={{ duration: reduce ? 0 : 0.7, ease: [0.2, 0.8, 0.2, 1], delay: reduce ? 0 : 0.08 + index * 0.045 }}
                    style={{
                      // Light accents on a dark projector theme need to stay
                      // behind the white labels, not turn into a white-on-cyan
                      // contrast failure. Alpha blends them into the theme.
                      background: surface.dark
                        ? `${theme.accentColor}${index === 0 ? "88" : "66"}`
                        : index === 0
                          ? theme.accentColor
                          : `${theme.accentColor}8f`,
                    }}
                  />
                  <div className="absolute inset-0 flex items-center gap-3 px-4">
                    <span className="text-2xl" aria-hidden>{entry.avatar || FALLBACK_AVATAR}</span>
                    <span className="min-w-0 flex-1 truncate text-lg font-bold">{entry.nickname}</span>
                    <Movement delta={entry.delta} />
                  </div>
                </div>

                <span className="text-right font-mono text-lg font-black tabular-nums">
                  {entry.totalPoints.toLocaleString()}
                  <span className="ml-1 text-[0.65rem] uppercase opacity-45">{t("quiz.pointsShort")}</span>
                </span>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {top.length === 0 && (
          <div className="flex h-full items-center justify-center font-heading text-4xl opacity-45">
            {t("quiz.noResponsesYet")}
          </div>
        )}
      </div>

      <div className="relative mt-5 flex justify-end gap-3 border-t pt-4" style={{ borderColor: surface.border }}>
        {!final && onNext && (
          <button
            onClick={onNext}
            className="px-8 py-3 font-mono text-sm font-black uppercase tracking-[0.12em] transition-transform hover:-translate-y-0.5"
            style={{ background: theme.accentColor, color: readableOn(theme.accentColor) }}
          >
            {t("quiz.nextSlide")} →
          </button>
        )}
        {onEnd && (
          <button
            onClick={onEnd}
            className="border px-8 py-3 font-mono text-sm font-black uppercase tracking-[0.12em] transition-opacity hover:opacity-75"
            style={{ borderColor: theme.accentColor, color: theme.accentColor }}
          >
            {t("quiz.endSession")}
          </button>
        )}
      </div>
    </div>
  )
}
