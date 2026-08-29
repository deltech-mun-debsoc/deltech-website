"use client"

import type { ScaleTally, ScaleConfig, PresentationTheme } from "@/lib/quiz-types"
import { quizSurface } from "@/lib/quiz-theme"

interface Props {
  tally: ScaleTally
  config: ScaleConfig
  theme: PresentationTheme
}

export function VizScale({ tally, config, theme }: Props) {
  const surface = quizSurface(theme)
  const { statements, min, max, minLabel, maxLabel } = config
  const { averages } = tally
  const range = max - min

  return (
    <div className="w-full space-y-6 px-6 py-2">
      {/* Axis labels */}
      <div className="flex justify-between text-xs opacity-60" style={{ color: theme.textColor }}>
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>

      {statements.map((stmt, i) => {
        const avg = averages[i] ?? min
        const pct = range > 0 ? ((avg - min) / range) * 100 : 50

        return (
          <div key={i} className="space-y-2">
            <p className="text-sm" style={{ color: theme.textColor }}>{stmt}</p>
            <div className="relative h-2 w-full rounded-full" style={{ background: surface.track }}>
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, background: theme.accentColor }}
              />
              <div
                className="absolute -top-1 size-4 -translate-x-1/2 rounded-full border-2 transition-all duration-700"
                style={{
                  left: `${pct}%`,
                  borderColor: theme.accentColor,
                  background: theme.background,
                }}
              />
            </div>
            <p
              className="text-right text-xs font-semibold tabular-nums"
              style={{ color: theme.accentColor }}
            >
              avg {avg.toFixed(1)}
            </p>
          </div>
        )
      })}

      {tally.totalVotes === 0 && (
        <p className="text-center text-sm opacity-50" style={{ color: theme.textColor }}>
          No responses yet
        </p>
      )}
    </div>
  )
}
