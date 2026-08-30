"use client"

import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
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

export function LeaderboardScreen({ entries, final, theme, onNext, onEnd }: Props) {
  const surface = quizSurface(theme)

  const top = entries.slice(0, 10)

  return (
    <div
      className="relative flex h-full flex-col items-center justify-start gap-6 overflow-hidden px-8 py-10"
      style={{ background: theme.background, color: theme.textColor, fontFamily: theme.font }}
    >
      <ConfettiBurst active={final} />

      <h2 className="text-3xl font-bold" style={{ color: theme.accentColor }}>
        {final ? t("quiz.finalResults") : t("quiz.leaderboard")}
      </h2>

      {/* Podium, final board only. The top three earned a moment; a flat list
          gives the winner the same visual weight as fourth place. */}
      {final && top.length >= 3 && (
        <div className="flex w-full max-w-xl items-end justify-center gap-3">
          {[1, 0, 2].map((index) => {
            const entry = top[index]
            if (!entry) return null
            const height = index === 0 ? "h-32" : index === 1 ? "h-24" : "h-20"
            return (
              <motion.div
                key={entry.nickname}
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.15 * (index === 0 ? 2 : index === 1 ? 0 : 1), type: "spring", stiffness: 200, damping: 18 }}
                className="flex flex-1 flex-col items-center gap-2"
              >
                <span className="text-4xl">{entry.avatar || FALLBACK_AVATAR}</span>
                <span className="max-w-full truncate text-sm font-medium">{entry.nickname}</span>
                <div
                  className={cn("flex w-full items-start justify-center rounded-t-xl pt-2", height)}
                  style={{
                    background: index === 0 ? theme.accentColor + "55" : surface.track,
                    border: `1px solid ${index === 0 ? theme.accentColor + "88" : "transparent"}`,
                  }}
                >
                  <span className="text-2xl font-bold" style={{ color: theme.accentColor }}>
                    {t("quiz.rankN", { n: entry.rank })}
                  </span>
                </div>
                <span className="font-bold tabular-nums" style={{ color: theme.accentColor }}>
                  {entry.totalPoints.toLocaleString()}
                </span>
              </motion.div>
            )
          })}
        </div>
      )}

      <div className="w-full max-w-xl space-y-2">
        <AnimatePresence>
          {top.map((entry, i) => (
            <motion.div
              key={entry.nickname}
              // `layout` is what makes a rank change read as movement: rows slide
              // past each other instead of the numbers silently swapping.
              layout
              initial={{ x: -60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: i * 0.07, type: "spring", stiffness: 180, damping: 20 }}
              className="flex items-center gap-4 rounded-xl px-4 py-3"
              style={{
                background: i === 0 ? theme.accentColor + "33" : surface.track,
                border: i === 0 ? `1px solid ${theme.accentColor}66` : "1px solid transparent",
              }}
            >
              <span className="w-8 text-center text-lg font-bold" style={{ color: theme.accentColor }}>
                {t("quiz.rankN", { n: entry.rank })}
              </span>
              <span className="text-2xl">{entry.avatar || FALLBACK_AVATAR}</span>
              <span className="flex-1 font-medium">{entry.nickname}</span>
              <span className="font-bold tabular-nums" style={{ color: theme.accentColor }}>
                {entry.totalPoints.toLocaleString()}
              </span>
              {entry.delta !== undefined && (
                <span
                  className="text-xs tabular-nums"
                  style={{ color: entry.delta > 0 ? "#22c55e" : entry.delta < 0 ? "#ef4444" : undefined, opacity: 0.7 }}
                >
                  {entry.delta > 0 ? `▲${entry.delta}` : entry.delta < 0 ? `▼${Math.abs(entry.delta)}` : "-"}
                </span>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Controls */}
      <div className="mt-auto flex gap-3">
        {!final && onNext && (
          <button
            onClick={onNext}
            className="rounded-xl px-8 py-2.5 font-semibold transition-opacity hover:opacity-90"
            style={{ background: theme.accentColor, color: readableOn(theme.accentColor) }}
          >
            {t("quiz.nextSlide")}
          </button>
        )}
        {onEnd && (
          <button
            onClick={onEnd}
            className="rounded-xl border px-8 py-2.5 font-semibold transition-opacity hover:opacity-80"
            style={{ borderColor: theme.accentColor, color: theme.accentColor }}
          >
            {t("quiz.endSession")}
          </button>
        )}
      </div>
    </div>
  )
}
