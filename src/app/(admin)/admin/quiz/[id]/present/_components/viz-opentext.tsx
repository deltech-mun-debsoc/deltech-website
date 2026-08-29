"use client"

import { motion, AnimatePresence } from "framer-motion"
import type { OpenTextTally, OpenTextConfig, PresentationTheme } from "@/lib/quiz-types"
import { quizSurface } from "@/lib/quiz-theme"

interface Props {
  tally: OpenTextTally
  config: OpenTextConfig
  theme: PresentationTheme
}

export function VizOpenText({ tally, config, theme }: Props) {
  const surface = quizSurface(theme)
  const { responses } = tally

  if (responses.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm opacity-50" style={{ color: theme.textColor }}>
        No responses yet
      </div>
    )
  }

  if (config.layout === "SPEECH_BUBBLES") {
    return (
      <div className="flex flex-wrap gap-3 px-4 py-2 max-h-72 overflow-y-auto">
        <AnimatePresence>
          {responses.map((r, i) => (
            <motion.div
              key={i}
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.05, type: "spring", stiffness: 200 }}
              className="max-w-56 rounded-2xl px-4 py-2.5 text-sm"
              style={{ background: theme.accentColor + "33", color: theme.textColor, border: `1px solid ${theme.accentColor}55` }}
            >
              <p className="leading-snug">{r.text}</p>
              <p className="mt-1 text-xs opacity-60">{r.nickname}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    )
  }

  // FLOWING_GRID
  return (
    <div className="grid grid-cols-3 gap-2 px-4 py-2 max-h-72 overflow-y-auto">
      <AnimatePresence>
        {responses.map((r, i) => (
          <motion.div
            key={i}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: i * 0.04 }}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ background: surface.track, color: theme.textColor }}
          >
            <p className="leading-snug line-clamp-3">{r.text}</p>
            <p className="mt-0.5 text-xs opacity-50">{r.nickname}</p>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
