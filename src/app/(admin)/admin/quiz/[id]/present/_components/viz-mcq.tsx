"use client"

import type { MCQTally } from "@/lib/quiz-types"
import type { MCQConfig, PresentationTheme, MCQLayout } from "@/lib/quiz-types"
import { quizSurface } from "@/lib/quiz-theme"

interface Props {
  tally: MCQTally
  config: MCQConfig
  theme: PresentationTheme
  revealedIndices?: number[]
  layout?: MCQLayout
}

export function VizMCQ({ tally, config, theme, revealedIndices, layout = "BARS" }: Props) {
  const surface = quizSurface(theme)

  const { options } = config
  const { counts, totalVotes } = tally
  const max = Math.max(...counts, 1)

  if (layout === "BARS") {
    return (
      <div
        className="grid h-full min-h-[20rem] w-full items-end gap-3 px-4"
        style={{ gridTemplateColumns: `repeat(${Math.max(options.length, 1)}, minmax(0, 1fr))` }}
      >
        {options.map((opt, i) => {
          const pct = totalVotes > 0 ? Math.round((counts[i] ?? 0) / totalVotes * 100) : 0
          const height = counts[i] ? Math.max(6, Math.round(((counts[i] ?? 0) / max) * 100)) : 0
          const revealed = revealedIndices !== undefined
          const isCorrect = revealedIndices?.includes(i)
          return (
            <div key={i} className="flex h-full min-w-0 flex-col items-center">
              <div className="mb-2 text-center font-mono tabular-nums" style={{ color: theme.textColor }}>
                <span className="block text-lg font-black">{pct}%</span>
                <span className="block text-[0.65rem] font-bold uppercase opacity-50">{counts[i] ?? 0}</span>
              </div>
              <div className="relative flex min-h-0 w-full flex-1 items-end overflow-hidden" style={{ background: surface.track }}>
                  <div
                    className="w-full transition-[height,background-color] duration-700 ease-out"
                    style={{
                      height: `${height}%`,
                      background: revealed
                        ? isCorrect ? "#22c55e" : surface.border
                        : theme.accentColor,
                    }}
                  />
                  <span
                    className="absolute bottom-2 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center border font-mono text-xs font-black"
                    style={{
                      borderColor: isCorrect ? "#22c55e" : theme.textColor,
                      color: isCorrect ? "#22c55e" : theme.textColor,
                      background: theme.background,
                    }}
                  >
                    {isCorrect ? "✓" : String.fromCharCode(65 + i)}
                  </span>
              </div>
              <span
                className="mt-3 line-clamp-2 min-h-12 w-full text-center font-heading text-lg leading-tight"
                style={{ color: theme.textColor }}
                title={opt}
              >
                {opt}
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  if (layout === "DONUT") {
    return <DonutViz counts={counts} options={options} theme={theme} revealedIndices={revealedIndices} />
  }

  if (layout === "PIE") {
    return <PieViz counts={counts} options={options} theme={theme} revealedIndices={revealedIndices} />
  }

  // DOTS
  return (
    <div className="flex flex-wrap justify-center gap-2 px-4">
      {options.map((opt, i) => {
        const n = counts[i] ?? 0
        const isCorrect = revealedIndices?.includes(i)
        return (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="flex flex-wrap justify-center gap-1">
              {Array.from({ length: Math.min(n, 20) }, (_, d) => (
                <span
                  key={d}
                  className="size-3 rounded-full"
                  style={{
                    background: isCorrect ? "#22c55e" : theme.accentColor,
                    opacity: 0.85,
                  }}
                />
              ))}
            </div>
            <span className="text-xs text-center max-w-20" style={{ color: theme.textColor }}>{opt} ({n})</span>
          </div>
        )
      })}
    </div>
  )
}

const PALETTE = ["#0f766e", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#22c55e", "#f97316", "#06b6d4", "#84cc16", "#e11d48"]

function DonutViz({ counts, options, theme, revealedIndices }: { counts: number[]; options: string[]; theme: PresentationTheme; revealedIndices?: number[] }) {
  const surface = quizSurface(theme)
  const total = counts.reduce((a, b) => a + b, 0)
  const r = 80
  const cx = 120
  const cy = 120
  const circumference = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="flex items-center gap-6 px-4">
      <svg width={240} height={240} viewBox="0 0 240 240">
        <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={36} stroke={surface.track} />
        {counts.map((c, i) => {
          const pct = total > 0 ? c / total : 0
          const dash = pct * circumference
          const el = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              strokeWidth={36}
              stroke={revealedIndices?.includes(i) ? "#22c55e" : PALETTE[i % PALETTE.length]}
              strokeDasharray={`${dash} ${circumference}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ transition: "stroke-dasharray 0.7s ease" }}
            />
          )
          offset += dash
          return el
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" fill={theme.textColor} fontSize={28} fontWeight={700}>{total}</text>
        <text x={cx} y={cy + 16} textAnchor="middle" fill={theme.textColor} fontSize={11} opacity={0.7}>votes</text>
      </svg>
      <div className="space-y-1.5">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2 text-sm" style={{ color: theme.textColor }}>
            <span className="size-3 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="max-w-48 truncate">{opt}</span>
            <span className="ml-auto font-semibold tabular-nums">{counts[i] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PieViz({ counts, options, theme, revealedIndices }: { counts: number[]; options: string[]; theme: PresentationTheme; revealedIndices?: number[] }) {
  const total = counts.reduce((a, b) => a + b, 0)
  const cx = 110
  const cy = 110
  const r = 100
  let startAngle = -Math.PI / 2
  const slices: React.ReactNode[] = []

  for (let i = 0; i < counts.length; i++) {
    const pct = total > 0 ? counts[i] / total : 0
    const angle = pct * 2 * Math.PI
    if (angle === 0) { startAngle += angle; continue }
    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(startAngle + angle)
    const y2 = cy + r * Math.sin(startAngle + angle)
    const large = angle > Math.PI ? 1 : 0
    slices.push(
      <path
        key={i}
        d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`}
        fill={revealedIndices?.includes(i) ? "#22c55e" : PALETTE[i % PALETTE.length]}
        opacity={0.9}
        style={{ transition: "opacity 0.3s" }}
      />
    )
    startAngle += angle
  }

  return (
    <div className="flex items-center gap-6 px-4">
      <svg width={220} height={220} viewBox="0 0 220 220">{slices}</svg>
      <div className="space-y-1.5">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2 text-sm" style={{ color: theme.textColor }}>
            <span className="size-3 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="max-w-40 truncate">{opt}</span>
            <span className="ml-auto font-semibold tabular-nums">{counts[i] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
