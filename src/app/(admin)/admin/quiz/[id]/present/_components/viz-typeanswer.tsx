"use client"

import { motion } from "framer-motion"
import type { PresentationTheme, TypeAnswerTally } from "@/lib/quiz-types"
import { quizSurface } from "@/lib/quiz-theme"

// What the room typed, most common first. Correct answers are marked only after
// the host reveals: showing them live would tell everyone still typing what to
// write.
export function VizTypeAnswer({
  tally,
  theme,
  revealed,
}: {
  tally: TypeAnswerTally
  theme: PresentationTheme
  revealed: boolean
}) {
  const surface = quizSurface(theme)

  const max = Math.max(1, ...tally.answers.map((a) => a.count))

  return (
    <div className="flex w-full flex-col gap-2.5">
      {tally.answers.map((answer, i) => {
        const highlight = revealed && answer.correct
        return (
          <motion.div
            key={answer.text}
            layout
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04, type: "spring", stiffness: 200, damping: 22 }}
            className="flex items-center gap-3"
          >
            <div className="relative h-11 flex-1 overflow-hidden rounded-lg" style={{ background: surface.track }}>
              <motion.div
                className="absolute inset-y-0 left-0 rounded-lg"
                initial={{ width: 0 }}
                animate={{ width: `${(answer.count / max) * 100}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
                style={{
                  background: highlight ? "#22c55e" : theme.accentColor,
                  opacity: revealed && !answer.correct ? 0.3 : 0.85,
                }}
              />
              <span className="relative z-10 flex h-full items-center gap-2 px-4 text-lg font-medium">
                {highlight && <span aria-hidden>✓</span>}
                <span className="truncate">{answer.text}</span>
              </span>
            </div>
            <span className="w-12 shrink-0 text-right font-mono text-lg tabular-nums opacity-70">
              {answer.count}
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}
