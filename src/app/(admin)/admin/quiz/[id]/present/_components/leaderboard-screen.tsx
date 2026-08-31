"use client"

import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowDown, ArrowUp, Minus, Trophy } from "lucide-react"
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
      <span className="font-mono text-[0.65rem] font-black uppercase tracking-[0.12em] opacity-55">
        {t("quiz.joinedBoard")}
      </span>
    )
  }
  if (delta > 0) {
    return <span className="flex items-center font-mono text-xs font-black text-emerald-500"><ArrowUp className="size-4" />{delta}</span>
  }
  if (delta < 0) {
    return <span className="flex items-center font-mono text-xs font-black text-rose-500"><ArrowDown className="size-4" />{Math.abs(delta)}</span>
  }
  return <Minus className="size-4 opacity-30" aria-label={t("quiz.heldPosition")} />
}

export function LeaderboardScreen({ entries, final, theme, onNext, onEnd }: Props) {
  const surface = quizSurface(theme)
  const reduce = useReducedMotion()
  const top = entries.slice(0, 10)
  const maxScore = Math.max(...top.map((entry) => entry.totalPoints), 1)

  return (
    <div className="relative flex h-full flex-col overflow-hidden px-8 py-7" style={{ background: theme.background, color: theme.textColor }}>
      <div className="paper-grid pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden />
      <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full border opacity-25" style={{ borderColor: theme.accentColor }} aria-hidden />
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
              <p className="font-mono text-[0.65rem] font-black uppercase tracking-[0.16em] opacity-55">{t("quiz.rankN", { n: 1 })}</p>
              <p className="max-w-52 truncate font-heading text-2xl">{top[0].nickname}</p>
            </div>
          </motion.div>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        {top.length > 0 ? (
          <div className="grid h-full items-end gap-3" style={{ gridTemplateColumns: `repeat(${top.length}, minmax(0, 1fr))` }}>
            <AnimatePresence initial={false}>
              {top.map((entry, index) => {
                const height = Math.max(8, (entry.totalPoints / maxScore) * 100)
                return (
                  <motion.div
                    key={entry.nickname}
                    layout
                    initial={reduce ? false : { x: entry.delta === undefined ? 18 : entry.delta * 72, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={reduce ? undefined : { opacity: 0 }}
                    transition={{ layout: { type: "spring", stiffness: 210, damping: 24 }, delay: reduce ? 0 : index * 0.045 }}
                    className="flex h-full min-w-0 flex-col items-center"
                  >
                    <div className="mb-2 flex h-5 items-center justify-center"><Movement delta={entry.delta} /></div>
                    <p className="mb-2 font-mono text-base font-black tabular-nums">
                      {entry.totalPoints.toLocaleString()}
                      <span className="ml-1 text-[0.55rem] uppercase opacity-45">{t("quiz.pointsShort")}</span>
                    </p>
                    <div className="relative flex min-h-0 w-full flex-1 items-end overflow-hidden" style={{ background: surface.track }}>
                      <motion.div
                        className="w-full"
                        initial={reduce ? false : { height: 0 }}
                        animate={{ height: `${height}%` }}
                        transition={{ duration: reduce ? 0 : 0.75, ease: [0.2, 0.8, 0.2, 1], delay: reduce ? 0 : 0.08 + index * 0.045 }}
                        style={{
                          background: surface.dark
                            ? `${theme.accentColor}${index === 0 ? "88" : "66"}`
                            : index === 0 ? theme.accentColor : `${theme.accentColor}8f`,
                        }}
                      />
                      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 font-mono text-xs font-black opacity-65">
                        {t("quiz.rankN", { n: entry.rank })}
                      </span>
                    </div>
                    <div className="mt-3 flex w-full min-w-0 flex-col items-center gap-1 text-center">
                      <span className="text-3xl" aria-hidden>{entry.avatar || FALLBACK_AVATAR}</span>
                      <span className="w-full truncate text-sm font-bold">{entry.nickname}</span>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center font-heading text-4xl opacity-45">{t("quiz.noResponsesYet")}</div>
        )}
      </div>

      <div className="relative mt-5 flex justify-end gap-3 border-t pt-4" style={{ borderColor: surface.border }}>
        {!final && onNext && (
          <button onClick={onNext} className="px-8 py-3 font-mono text-sm font-black uppercase tracking-[0.12em] transition-transform hover:-translate-y-0.5" style={{ background: theme.accentColor, color: readableOn(theme.accentColor) }}>
            {t("quiz.nextSlide")} →
          </button>
        )}
        {onEnd && (
          <button onClick={onEnd} className="border px-8 py-3 font-mono text-sm font-black uppercase tracking-[0.12em] transition-opacity hover:opacity-75" style={{ borderColor: theme.accentColor, color: theme.accentColor }}>
            {t("quiz.endSession")}
          </button>
        )}
      </div>
    </div>
  )
}
