// ── Slide config types ───────────────────────────────────────────────────────

export type MCQLayout = "BARS" | "DONUT" | "PIE" | "DOTS"
export type OpenTextLayout = "SPEECH_BUBBLES" | "FLOWING_GRID"
export type SlideType =
  | "MCQ"
  | "TRUE_FALSE"
  | "TYPE_ANSWER"
  | "NUMERIC"
  | "WORDCLOUD"
  | "SCALE"
  | "OPEN_TEXT"
  | "CONTENT"

// Scoring knobs shared by every scored slide type. All optional: an existing
// slide with none of them set scores exactly as it did before (1000 points, a
// half-weight speed bonus, no streak).
export type ScoringConfig = {
  basePoints?: number       // default 1000
  speedWeight?: number      // 0-1, default 0.5. 0 = speed does not matter
  streakBonus?: number      // points per consecutive correct answer, default 0
}
export type SlideMode = "POLL" | "QUIZ"

export type MCQConfig = ScoringConfig & {
  options: string[]        // 2–10 items
  correct: number[]        // option indices (quiz mode)
  layout: MCQLayout        // default BARS
  allowMultiple: boolean   // multiple correct answers
  // Award a share of the points for a partly-right multi-select. Without this,
  // picking 2 of 3 correct options scores the same as picking nothing.
  partialCredit: boolean
  timerSeconds: number | null
}

// True/false is a two-option MCQ, deliberately: the tally, the reveal and the
// projected visualisation all work unchanged, and the builder gets a one-click
// slide type instead of asking someone to type "True" and "False" every time.
export type TrueFalseConfig = MCQConfig

export type TypeAnswerConfig = ScoringConfig & {
  accepted: string[]       // any one of these counts as correct
  // Exact means character-for-character after normalising case and whitespace.
  // Otherwise punctuation is ignored too.
  exact: boolean
  timerSeconds: number | null
}

export type NumericConfig = ScoringConfig & {
  target: number
  // Answers within this distance earn a share of the points, scaling to zero at
  // the edge. 0 means only the exact number counts.
  tolerance: number
  unit: string             // shown next to the input, e.g. "kg", "%"
  timerSeconds: number | null
}

export type WordCloudConfig = {
  allowMultiple: boolean   // allow multiple submissions per person
  profanityFilter: boolean // default true
  timerSeconds: number | null
}

export type ScaleConfig = {
  min: number              // 1
  max: number              // 2–8
  minLabel: string         // e.g. "Strongly disagree"
  maxLabel: string         // e.g. "Strongly agree"
  statements: string[]     // 1–8 items
  timerSeconds: number | null
}

export type OpenTextConfig = {
  maxLength: number        // 1–200 (hard cap 200)
  layout: OpenTextLayout
  timerSeconds: number | null
}

export type ContentConfig = {
  body: string
}

export type SlideConfig =
  | MCQConfig
  | TypeAnswerConfig
  | NumericConfig
  | WordCloudConfig
  | ScaleConfig
  | OpenTextConfig
  | ContentConfig

export interface SlideData {
  id: string
  order: number
  type: SlideType
  prompt: string
  config: SlideConfig
}

// Slide types that produce a right answer. Everything else is an opinion.
export const DEFAULT_BASE_POINTS_LABEL = "1000"

export const SCORED_TYPES: SlideType[] = ["MCQ", "TRUE_FALSE", "TYPE_ANSWER", "NUMERIC"]

export function isScoredType(type: SlideType): boolean {
  return SCORED_TYPES.includes(type)
}

// ── Presentation theme ────────────────────────────────────────────────────────

export interface PresentationTheme {
  background: string
  textColor: string
  accentColor: string
  font: string
}

export interface PresentationData {
  id: string
  title: string
  mode: SlideMode
  theme: PresentationTheme | null
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_MCQ_CONFIG: MCQConfig = {
  options: ["Option 1", "Option 2"],
  correct: [],
  layout: "BARS",
  allowMultiple: false,
  partialCredit: true,
  timerSeconds: null,
}

export const DEFAULT_TRUE_FALSE_CONFIG: TrueFalseConfig = {
  options: ["True", "False"],
  correct: [],
  layout: "BARS",
  allowMultiple: false,
  partialCredit: false,
  timerSeconds: null,
}

export const DEFAULT_TYPE_ANSWER_CONFIG: TypeAnswerConfig = {
  accepted: [""],
  exact: false,
  timerSeconds: null,
}

export const DEFAULT_NUMERIC_CONFIG: NumericConfig = {
  target: 0,
  tolerance: 0,
  unit: "",
  timerSeconds: null,
}

export const DEFAULT_WORDCLOUD_CONFIG: WordCloudConfig = {
  allowMultiple: false,
  profanityFilter: true,
  timerSeconds: null,
}

export const DEFAULT_SCALE_CONFIG: ScaleConfig = {
  min: 1,
  max: 5,
  minLabel: "Strongly disagree",
  maxLabel: "Strongly agree",
  statements: ["How much do you agree with this statement?"],
  timerSeconds: null,
}

export const DEFAULT_OPEN_TEXT_CONFIG: OpenTextConfig = {
  maxLength: 200,
  layout: "SPEECH_BUBBLES",
  timerSeconds: null,
}

export const DEFAULT_CONTENT_CONFIG: ContentConfig = {
  body: "",
}

export const DEFAULT_CONFIGS: Record<SlideType, SlideConfig> = {
  MCQ:         DEFAULT_MCQ_CONFIG,
  TRUE_FALSE:  DEFAULT_TRUE_FALSE_CONFIG,
  TYPE_ANSWER: DEFAULT_TYPE_ANSWER_CONFIG,
  NUMERIC:     DEFAULT_NUMERIC_CONFIG,
  WORDCLOUD:   DEFAULT_WORDCLOUD_CONFIG,
  SCALE:     DEFAULT_SCALE_CONFIG,
  OPEN_TEXT: DEFAULT_OPEN_TEXT_CONFIG,
  CONTENT:   DEFAULT_CONTENT_CONFIG,
}

// ── Preset themes ─────────────────────────────────────────────────────────────

export const PRESET_THEMES: Record<string, PresentationTheme> = {
  classic: { background: "#f7f4ec", textColor: "#2b2622", accentColor: "#1f6f6b", font: "Inter" },
  ink:     { background: "#211d19", textColor: "#f1ece2", accentColor: "#63b0aa", font: "Inter" },
  gold:    { background: "#f7f4ec", textColor: "#3a2f18", accentColor: "#b8892e", font: "Georgia" },
  ocean:   { background: "#0c4a6e", textColor: "#e0f2fe", accentColor: "#38bdf8", font: "Inter" },
  forest:  { background: "#14532d", textColor: "#f0fdf4", accentColor: "#86efac", font: "Inter" },
}

export const DEFAULT_THEME = PRESET_THEMES.classic

// Which preset a theme *is*, or null once its colours have been hand-edited.
// The builder's theme trigger used to print "Classic" unconditionally, so every
// theme looked unapplied: you picked Ocean, the projector went blue, and the
// control still read Classic.
export function presetThemeKey(theme: PresentationTheme): string | null {
  const match = Object.entries(PRESET_THEMES).find(
    ([, p]) =>
      p.background === theme.background &&
      p.textColor === theme.textColor &&
      p.accentColor === theme.accentColor &&
      p.font === theme.font,
  )
  return match ? match[0] : null
}

// Everything a participant must NOT be given before they answer.
//
// The presenter used to strip only MCQ's `correct` before broadcasting, back
// when MCQ was the only scored type. The three formats added since shipped the
// answer to every phone in the room: TRUE_FALSE carried `correct`, TYPE_ANSWER
// carried the whole `accepted` list, and NUMERIC carried `target` and
// `tolerance`. None of it was on screen, but it was one devtools panel -- or one
// look at the realtime frames -- away, on the exact questions being scored.
//
// One function, used by every path that hands a slide to a participant, so a
// new scored type cannot leak by being forgotten in a second place.
export function redactSlide(slide: SlideData): SlideData {
  switch (slide.type) {
    case "MCQ":
    case "TRUE_FALSE":
      return { ...slide, config: { ...asMCQ(slide.config), correct: [] } }
    case "TYPE_ANSWER":
      return { ...slide, config: { ...asTypeAnswer(slide.config), accepted: [] } }
    case "NUMERIC": {
      const config = asNumeric(slide.config)
      // The unit stays: the phone has to label its own input box.
      return { ...slide, config: { ...config, target: 0, tolerance: 0 } }
    }
    default:
      return slide
  }
}

// ── Cast helpers ──────────────────────────────────────────────────────────────

export const asMCQ        = (c: SlideConfig) => c as MCQConfig
export const asTypeAnswer = (c: SlideConfig) => c as TypeAnswerConfig
export const asNumeric    = (c: SlideConfig) => c as NumericConfig
export const asWordCloud = (c: SlideConfig) => c as WordCloudConfig
export const asScale     = (c: SlideConfig) => c as ScaleConfig
export const asOpenText  = (c: SlideConfig) => c as OpenTextConfig
export const asContent   = (c: SlideConfig) => c as ContentConfig

export function parseConfig(raw: unknown, type: SlideType): SlideConfig {
  const defaults = DEFAULT_CONFIGS[type]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults
  return { ...defaults, ...(raw as object) } as SlideConfig
}

// ── Avatars ───────────────────────────────────────────────────────────────────

// Grouped so the picker can show sections rather than one undifferentiated wall
// of 20 animals. Every entry is a single emoji: they are rendered at large sizes
// on a projector, and multi-codepoint sequences render inconsistently across
// Android versions.
export const AVATAR_GROUPS: { key: string; emoji: readonly string[] }[] = [
  {
    key: "animals",
    emoji: [
      "🦁","🐯","🐻","🦊","🐸","🐧","🦅","🦋","🦄","🐊",
      "🦖","🐙","🦑","🐳","🦈","🐝","🦉","🐺","🦝","🐲",
      "🐨","🐼","🦥","🦦","🦔","🐢","🦜","🦩","🐬","🦭",
    ],
  },
  {
    key: "faces",
    emoji: ["😎","🤓","🥳","🤠","🧐","🤖","👽","🤡","👻","💀","🎃","😺"],
  },
  {
    key: "things",
    emoji: [
      "🚀","⚡","🔥","🌈","⭐","🌙","☄️","🎯","🎲","🎸",
      "🏆","💎","🍕","🍩","🌮","🧃","⚽","🏀","🎧","📚",
    ],
  },
  {
    key: "world",
    emoji: ["🌍","🌏","🗽","🏛️","⛰️","🌋","🏝️","🌵","🍁","🌊"],
  },
]

export const AVATARS = AVATAR_GROUPS.flatMap((g) => g.emoji)

// Shown when a participant has no avatar: an old response row from before they
// were stored, or someone who never picked one.
export const FALLBACK_AVATAR = "👤"

// ── Realtime broadcast events ─────────────────────────────────────────────────

export type LBEntry = {
  nickname: string
  avatar: string
  totalPoints: number
  rank: number
  delta?: number   // rank change from last leaderboard
}

export type PresenceEntry = {
  nickname: string
  avatar: string
  userId: string
}

export type QuizBroadcast =
  | { event: "START" }
  | { event: "GOTO"; slideId: string; slideIndex: number; slideCount: number; slide: SlideData }
  | { event: "LOCK" }
  | { event: "UNLOCK" }
  | { event: "REVEAL"; correctIndices: number[]; correctAnswers: string[] }
  | { event: "LEADERBOARD"; entries: LBEntry[]; final: boolean }
  | { event: "END" }

// ── Tally types ───────────────────────────────────────────────────────────────

export type MCQTally = {
  type: "MCQ"
  totalVotes: number
  counts: number[]
  percentages: number[]
}
export type WordCloudTally = {
  type: "WORDCLOUD"
  totalVotes: number
  words: { text: string; count: number }[]
}
export type ScaleTally = {
  type: "SCALE"
  totalVotes: number
  averages: number[]
  distributions: number[][]
}
export type OpenTextTally = {
  type: "OPEN_TEXT"
  totalVotes: number
  responses: { text: string; nickname: string }[]
}
// Typed answers, grouped by their normalised form so "Kofi Annan" and
// "kofi  annan" are one bar rather than two.
export type TypeAnswerTally = {
  type: "TYPE_ANSWER"
  totalVotes: number
  answers: { text: string; count: number; correct: boolean }[]
}

// Numeric guesses, kept individually so the projector can plot the spread
// against the target rather than just counting exact hits.
export type NumericTally = {
  type: "NUMERIC"
  totalVotes: number
  values: number[]
  average: number | null
  closest: number | null
}

export type ContentTally = { type: "CONTENT"; totalVotes: 0 }

export type Tally =
  | MCQTally
  | TypeAnswerTally
  | NumericTally
  | WordCloudTally
  | ScaleTally
  | OpenTextTally
  | ContentTally

export function parseTheme(raw: unknown): PresentationTheme {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_THEME
  return { ...DEFAULT_THEME, ...(raw as object) }
}
