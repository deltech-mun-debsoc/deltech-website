// Derived colours for the projected surface.
//
// The presenter screens hardcoded `rgba(255,255,255,0.12)` for borders and
// `rgba(255,255,255,0.08)` for fills, which assumes a dark background. The
// DEFAULT theme is cream (#f7f4ec), so on a fresh presentation every divider,
// track and card was white-on-cream: invisible. Three of the five preset themes
// are dark and two are light, so neither constant can be right.
//
// These derive from the theme's own text colour instead, which is always the
// contrasting one by construction.

import type { PresentationTheme } from "./quiz-types"

// Relative luminance, enough to answer "is this background dark?".
function isDark(hex: string): boolean {
  const value = hex.replace("#", "")
  if (value.length < 6) return false
  const r = parseInt(value.slice(0, 2), 16) / 255
  const g = parseInt(value.slice(2, 4), 16) / 255
  const b = parseInt(value.slice(4, 6), 16) / 255
  // Perceptual weights: green dominates apparent brightness.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5
}

function rgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "")
  if (value.length < 6) return `rgba(0,0,0,${alpha})`
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// Ink that stays readable on a given fill. Every accent-coloured button on the
// projector was hardcoded `color: "#fff"`, which is fine on the teal default and
// close to invisible on Ocean's #38bdf8 or the amber lock button -- the host
// could not read their own controls, and on the lobby the start button read as
// disabled when it was not.
export function readableOn(hex: string): string {
  return isDark(hex) ? "#ffffff" : "#111614"
}

export interface QuizSurface {
  /** Hairlines between regions. */
  border: string
  /** Empty track behind a bar or a card. */
  track: string
  /** A raised panel. */
  panel: string
  /** Secondary text: readable, clearly not primary. */
  muted: string
  /** True when the background is dark, for callers that must still branch. */
  dark: boolean
}

export function quizSurface(theme: PresentationTheme): QuizSurface {
  const dark = isDark(theme.background)
  // Derived from the text colour, so contrast holds on light and dark alike.
  const ink = theme.textColor
  return {
    border: rgba(ink, dark ? 0.14 : 0.16),
    track: rgba(ink, dark ? 0.1 : 0.08),
    panel: rgba(ink, dark ? 0.06 : 0.05),
    muted: rgba(ink, 0.62),
    dark,
  }
}
