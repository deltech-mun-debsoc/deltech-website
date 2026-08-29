"use client"

import { motion } from "framer-motion"
import { t } from "@/content/strings"
import type { NumericConfig, NumericTally, PresentationTheme } from "@/lib/quiz-types"

// Guesses plotted on a line against the target, so the room can see the spread
// rather than a single count. The target only appears once the host reveals.
export function VizNumeric({
  tally,
  config,
  theme,
  revealed,
}: {
  tally: NumericTally
  config: NumericConfig
  theme: PresentationTheme
  revealed: boolean
}) {
  if (tally.values.length === 0) {
    return <p className="text-center text-2xl opacity-50">{t("quiz.noResponsesYet")}</p>
  }

  // Scale to the data, always including the target so the reveal is never off
  // the edge of the axis.
  const points = revealed ? [...tally.values, config.target] : tally.values
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const position = (value: number) => ((value - min) / span) * 100

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="relative h-28">
        {/* The axis */}
        <div
          className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2"
          style={{ background: "rgba(255,255,255,0.18)" }}
        />

        {tally.values.map((value, i) => (
          <motion.div
            key={`${value}-${i}`}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${position(value)}%`,
              background: theme.accentColor,
              opacity: revealed ? 0.45 : 0.8,
            }}
          />
        ))}

        {revealed && (
          <motion.div
            initial={{ opacity: 0, scaleY: 0 }}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 18 }}
            className="absolute inset-y-0 w-0.5 -translate-x-1/2"
            style={{ left: `${position(config.target)}%`, background: "#22c55e" }}
          >
            <span className="absolute -top-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-0.5 text-sm font-bold" style={{ background: "#22c55e", color: "#052e16" }}>
              {config.target.toLocaleString()}{config.unit}
            </span>
          </motion.div>
        )}
      </div>

      <div className="flex justify-center gap-10 text-center">
        <Stat label={t("quiz.numericAverage")} value={tally.average} unit={config.unit} theme={theme} />
        {revealed && (
          <Stat label={t("quiz.numericClosest")} value={tally.closest} unit={config.unit} theme={theme} />
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  unit,
  theme,
}: {
  label: string
  value: number | null
  unit: string
  theme: PresentationTheme
}) {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-[0.16em] opacity-55">{label}</p>
      <p className="text-4xl font-bold tabular-nums" style={{ color: theme.accentColor }}>
        {value === null ? "-" : Math.round(value * 100) / 100}
        {unit && <span className="ml-1 text-2xl opacity-70">{unit}</span>}
      </p>
    </div>
  )
}
