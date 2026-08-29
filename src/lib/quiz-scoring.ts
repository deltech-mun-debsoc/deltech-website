// Quiz scoring. Pure: no Prisma, no fetch, no clock of its own, so
// scripts/check-quiz-scoring.ts can exercise every question type and every edge
// of the speed bonus without a database or a live session.
//
// The one rule that must never soften: elapsed time is passed IN, derived by the
// caller from the server's own record of when the slide went live. The request
// body's clock is not an input here and must never become one. Posting
// submittedAt: 0 used to score full marks on every correct answer.

import type { MCQConfig, NumericConfig, SlideConfig, SlideType, TypeAnswerConfig } from "./quiz-types"

// Kahoot's shape: answering instantly is worth the full amount, answering as the
// timer expires is worth half. Both ends are configurable per slide now, with
// these as the defaults, because a 5-second lightning round and a 90-second
// reading question do not deserve the same curve.
export const DEFAULT_BASE_POINTS = 1000
export const DEFAULT_SPEED_WEIGHT = 0.5

export interface ScoreInput {
  type: SlideType
  config: SlideConfig
  answer: unknown
  // Seconds since the slide went live, from the SERVER's clock. Null when the
  // slide has no timer or the start time is missing.
  elapsedSeconds: number | null
  // How many correct answers this participant has in a row, before this one.
  streak?: number
}

export interface ScoreResult {
  // null when the slide is not scored at all (a poll, or a quiz slide with no
  // correct answer configured). The UI shows no verdict in that case.
  correct: boolean | null
  points: number
  // Present only when a streak bonus actually applied, so the UI can say why.
  streakBonus?: number
}

// ---------------------------------------------------------------------------
// Per-type correctness
// ---------------------------------------------------------------------------

// How close a numeric answer has to be, as a fraction of the tolerance band,
// before it stops earning anything.
function numericAccuracy(submitted: number, target: number, tolerance: number): number {
  if (tolerance <= 0) return submitted === target ? 1 : 0
  const off = Math.abs(submitted - target)
  if (off > tolerance) return 0
  return 1 - off / tolerance
}

// Text answers are compared on their normalised form: case, surrounding space,
// and internal runs of whitespace are never what the question is testing.
export function normalizeAnswerText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function typeAnswerCorrect(submitted: string, config: TypeAnswerConfig): boolean {
  const given = normalizeAnswerText(submitted)
  if (!given) return false
  return config.accepted.some((accepted) => {
    const want = normalizeAnswerText(accepted)
    if (!want) return false
    if (config.exact) return given === want
    // Non-exact still means "the whole answer", not "contains": a question
    // asking for a country should not accept an essay containing it.
    return given === want || given.replace(/[^a-z0-9 ]/g, "") === want.replace(/[^a-z0-9 ]/g, "")
  })
}

// MCQ correctness, and how much of it. All-or-nothing was punishing: picking 2
// of 3 correct options scored exactly the same as picking nothing.
function mcqAccuracy(selected: number[], config: MCQConfig): { correct: boolean; accuracy: number } {
  const correctSet = new Set(config.correct)
  const chosen = new Set(selected)

  const hits = [...chosen].filter((i) => correctSet.has(i)).length
  const misses = [...chosen].filter((i) => !correctSet.has(i)).length
  const exact = hits === correctSet.size && misses === 0

  if (exact) return { correct: true, accuracy: 1 }
  if (!config.allowMultiple || !config.partialCredit) return { correct: false, accuracy: 0 }

  // Partial credit: reward what they got, penalise what they added. The penalty
  // is per wrong pick and weighted against the WRONG options available, so
  // selecting everything scores zero instead of beating an honest partial
  // answer. With 3 correct of 4 options, picking all four is (3/3 - 1/1) = 0.
  const wrongAvailable = config.options.length - correctSet.size
  const gained = hits / correctSet.size
  const lost = wrongAvailable > 0 ? misses / wrongAvailable : 0
  return { correct: false, accuracy: Math.max(0, Math.min(1, gained - lost)) }
}

// ---------------------------------------------------------------------------
// The scorer
// ---------------------------------------------------------------------------

export function scoreAnswer(input: ScoreInput): ScoreResult {
  const { type, config, answer, elapsedSeconds } = input

  const scored = scoredPortion(type, config, answer)
  if (scored === null) return { correct: null, points: 0 }

  const { correct, accuracy } = scored
  if (accuracy <= 0) return { correct, points: 0 }

  const base = basePointsOf(config)
  const speed = speedMultiplier(config, elapsedSeconds)
  let points = Math.round(base * accuracy * speed)

  // Streak: a small, capped bonus for consecutive correct answers. Only on a
  // fully correct answer, so partial credit never compounds into a run.
  let streakBonus: number | undefined
  const streakStep = streakStepOf(config)
  if (correct && streakStep > 0 && (input.streak ?? 0) > 0) {
    streakBonus = Math.min(input.streak ?? 0, MAX_STREAK) * streakStep
    points += streakBonus
  }

  return { correct, points, ...(streakBonus ? { streakBonus } : {}) }
}

// Beyond this a streak stops paying: a runaway leader should not be unreachable.
export const MAX_STREAK = 5

// Returns null when the slide is not scored at all.
function scoredPortion(
  type: SlideType,
  config: SlideConfig,
  answer: unknown,
): { correct: boolean; accuracy: number } | null {
  switch (type) {
    case "MCQ": {
      const mcq = config as MCQConfig
      if (!mcq.correct || mcq.correct.length === 0) return null
      const selected = (answer as { selectedIndices?: number[] })?.selectedIndices ?? []
      return mcqAccuracy(selected, mcq)
    }
    case "TRUE_FALSE": {
      // Modelled as a two-option MCQ so the tally, the reveal and the projected
      // visualisation all work unchanged.
      const mcq = config as MCQConfig
      if (!mcq.correct || mcq.correct.length === 0) return null
      const selected = (answer as { selectedIndices?: number[] })?.selectedIndices ?? []
      const correct = selected.length === 1 && mcq.correct.includes(selected[0])
      return { correct, accuracy: correct ? 1 : 0 }
    }
    case "TYPE_ANSWER": {
      const ta = config as TypeAnswerConfig
      if (!ta.accepted || ta.accepted.length === 0) return null
      const text = (answer as { text?: string })?.text ?? ""
      const correct = typeAnswerCorrect(text, ta)
      return { correct, accuracy: correct ? 1 : 0 }
    }
    case "NUMERIC": {
      const num = config as NumericConfig
      if (typeof num.target !== "number") return null
      const raw = (answer as { value?: number })?.value
      if (typeof raw !== "number" || !Number.isFinite(raw)) return { correct: false, accuracy: 0 }
      const accuracy = numericAccuracy(raw, num.target, num.tolerance)
      // Exactly right is "correct"; inside the band earns a share of the points
      // but is not a green tick.
      return { correct: accuracy === 1, accuracy }
    }
    default:
      // WORDCLOUD, SCALE, OPEN_TEXT, CONTENT: opinions, not answers.
      return null
  }
}

// ---------------------------------------------------------------------------
// Per-slide scoring configuration, with the old hardcoded values as defaults
// ---------------------------------------------------------------------------

interface ScoringFields {
  basePoints?: number
  speedWeight?: number
  streakBonus?: number
  timerSeconds?: number | null
}

function basePointsOf(config: SlideConfig): number {
  const value = (config as ScoringFields).basePoints
  return typeof value === "number" && value > 0 ? value : DEFAULT_BASE_POINTS
}

function streakStepOf(config: SlideConfig): number {
  const value = (config as ScoringFields).streakBonus
  return typeof value === "number" && value > 0 ? value : 0
}

// 1.0 answering instantly, down to (1 - speedWeight) as the timer runs out.
// No timer means no speed component at all, which is the honest answer: without
// a deadline there is nothing to be fast relative to.
export function speedMultiplier(config: SlideConfig, elapsedSeconds: number | null): number {
  const fields = config as ScoringFields
  const timer = fields.timerSeconds
  if (!timer || timer <= 0 || elapsedSeconds === null) return 1

  const weight =
    typeof fields.speedWeight === "number" && fields.speedWeight >= 0 && fields.speedWeight <= 1
      ? fields.speedWeight
      : DEFAULT_SPEED_WEIGHT

  // Clamped, so a missing or skewed start time degrades to the slowest score
  // rather than handing out a free maximum.
  const clamped = Math.min(Math.max(elapsedSeconds, 0), timer)
  return 1 - (clamped / timer) * weight
}
