"use client"

import { useEffect, useRef, useCallback } from "react"
import { Lock, Unlock, Eye, ChevronRight, Trophy } from "lucide-react"
import { CountdownRing } from "./countdown-ring"
import { VizMCQ } from "./viz-mcq"
import { VizWordCloud } from "./viz-wordcloud"
import { VizScale } from "./viz-scale"
import { VizOpenText } from "./viz-opentext"
import { VizTypeAnswer } from "./viz-typeanswer"
import { VizNumeric } from "./viz-numeric"
import { t } from "@/content/strings"
import type {
  SlideData, Tally, MCQTally, WordCloudTally, ScaleTally, OpenTextTally,
  TypeAnswerTally, NumericTally, PresentationTheme,
} from "@/lib/quiz-types"
import { asMCQ, asWordCloud, asScale, asOpenText, asNumeric, isScoredType } from "@/lib/quiz-types"
import { quizSurface, readableOn } from "@/lib/quiz-theme"

interface Props {
  slide: SlideData
  slideIndex: number
  slideCount: number
  tally: Tally | null
  theme: PresentationTheme
  mode: "POLL" | "QUIZ"
  locked: boolean
  revealed: boolean
  revealedIndices: number[]
  timerRunning: boolean
  // How many people are in the room, so the header can say "12 of 30" instead of
  // "12 of ?". The presenter already tracks this from the presence channel.
  participantCount?: number
  onLock: () => void
  onUnlock: () => void
  onReveal: () => void
  onNext: () => void
  onPrev: () => void
  onLeaderboard: () => void
  onTimerExpire: () => void
}

export function QuestionScreen({
  slide,
  slideIndex,
  slideCount,
  tally,
  theme,
  mode,
  locked,
  revealed,
  revealedIndices,
  timerRunning,
  onLock,
  onUnlock,
  onReveal,
  onNext,
  onPrev,
  onLeaderboard,
  onTimerExpire,
  participantCount,
}: Props) {
  const surface = quizSurface(theme)

  const config = slide.config
  const type = slide.type
  const timerSeconds =
    type !== "CONTENT"
      ? (config as { timerSeconds?: number | null }).timerSeconds ?? null
      : null

  const voteCount = tally?.totalVotes ?? 0
  const scoredQuiz = mode === "QUIZ" && isScoredType(type)
  const canAdvance = !scoredQuiz || revealed

  function renderViz() {
    if (!tally) return null
    switch (type) {
      case "MCQ":
        return (
          <VizMCQ
            tally={tally as MCQTally}
            config={asMCQ(config)}
            theme={theme}
            revealedIndices={revealed ? revealedIndices : undefined}
            layout={asMCQ(config).layout}
          />
        )
      // True/false shares the MCQ tally and chart: it IS a two-option MCQ.
      case "TRUE_FALSE":
        return (
          <VizMCQ
            tally={tally as MCQTally}
            config={asMCQ(config)}
            theme={theme}
            revealedIndices={revealed ? revealedIndices : undefined}
            layout={asMCQ(config).layout}
          />
        )
      case "TYPE_ANSWER":
        return <VizTypeAnswer tally={tally as TypeAnswerTally} theme={theme} revealed={revealed} />
      case "NUMERIC":
        return (
          <VizNumeric
            tally={tally as NumericTally}
            config={asNumeric(config)}
            theme={theme}
            revealed={revealed}
          />
        )
      case "WORDCLOUD":
        return <VizWordCloud tally={tally as WordCloudTally} theme={theme} />
      case "SCALE":
        return <VizScale tally={tally as ScaleTally} config={asScale(config)} theme={theme} />
      case "OPEN_TEXT":
        return <VizOpenText tally={tally as OpenTextTally} config={asOpenText(config)} theme={theme} />
      default:
        return null
    }
  }

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{ background: theme.background, color: theme.textColor }}
    >
      <div className="paper-grid pointer-events-none absolute inset-0 opacity-[0.055]" aria-hidden />
      <div className="pointer-events-none absolute -right-20 -top-44 size-[32rem] rounded-full border opacity-20" style={{ borderColor: theme.accentColor }} aria-hidden />

      {/* Stage status. Big counts make it readable from the back of a room. */}
      <div className="relative flex min-h-24 items-center gap-6 border-b px-9 py-4" style={{ borderColor: surface.border }}>
        <div>
          <span className="flex items-center gap-2 font-mono text-xs font-black uppercase tracking-[0.22em] opacity-55">
            <span className="size-2 animate-pulse" style={{ background: revealed ? "#22c55e" : theme.accentColor }} />
            {t(revealed ? "quiz.answerReveal" : "quiz.liveQuestion")}
          </span>
          <span className="mt-1 block font-mono text-sm font-bold uppercase tracking-[0.16em]">
            {t("quiz.slideProgress", { n: slideIndex + 1, total: slideCount })}
          </span>
        </div>
        <span className="flex-1" />
        <div className="text-right">
          <span className="block font-heading text-4xl leading-none tabular-nums">{voteCount}</span>
          <span className="font-mono text-[0.65rem] font-black uppercase tracking-[0.16em] opacity-50">
            {t("quiz.responsesIn", { count: voteCount })} · {t("quiz.playersInRoom", { count: participantCount ?? "?" })}
          </span>
        </div>
        {timerSeconds && (
          <CountdownRing
            durationSeconds={timerSeconds}
            running={timerRunning && !locked}
            accentColor={theme.accentColor}
            onExpire={onTimerExpire}
          />
        )}
      </div>

      {/* Prompt */}
      <div className="relative px-10 pb-6 pt-7">
        <h1 className="max-w-[22ch] font-heading text-[clamp(3.4rem,6vw,6.5rem)] leading-[0.92] tracking-[-0.04em]">
          {slide.prompt || t("quiz.builder.promptPlaceholder")}
        </h1>
      </div>

      {/* Viz */}
      <div className="relative min-h-0 flex-1 overflow-auto px-6 pb-4">
        {renderViz()}
        {type === "CONTENT" && (
          <div className="max-w-5xl px-4 font-heading text-4xl opacity-80" style={{ lineHeight: 1.35 }}>
            {(config as { body?: string }).body}
          </div>
        )}
      </div>

      {/* Host controls */}
      <div
        className="relative flex min-h-24 items-center gap-3 border-t px-8 py-4"
        style={{ borderColor: surface.border }}
      >
        <span className="mr-2 hidden font-mono text-[0.65rem] font-black uppercase tracking-[0.18em] opacity-40 xl:block">
          {t("quiz.hostControls")}
        </span>
        <button
          onClick={onPrev}
          disabled={slideIndex === 0}
          className="border px-4 py-2.5 font-mono text-xs font-black uppercase tracking-[0.1em] transition-opacity disabled:opacity-30 hover:opacity-80"
          style={{ borderColor: theme.accentColor, color: theme.accentColor }}
        >
          {t("quiz.prevSlide")}
        </button>

        {type !== "CONTENT" && !locked && (
          <button
            onClick={onLock}
            className="flex items-center gap-2 px-4 py-2.5 font-mono text-xs font-black uppercase tracking-[0.1em] transition-opacity hover:opacity-90"
            style={{ background: "#f59e0b", color: readableOn("#f59e0b") }}
          >
            <Lock className="size-3" /> {t("quiz.lockVoting")}
          </button>
        )}

        {type !== "CONTENT" && locked && !revealed && (
          <button
            onClick={onUnlock}
            className="flex items-center gap-2 border px-4 py-2.5 font-mono text-xs font-black uppercase tracking-[0.1em] transition-opacity hover:opacity-80"
            style={{ borderColor: theme.accentColor, color: theme.accentColor }}
          >
            <Unlock className="size-3" /> {t("quiz.unlockVoting")}
          </button>
        )}

        {/* Every scored type gets a reveal button, not only MCQ: a typed or
            numeric question is just as revealable, and the phones are waiting
            on it before they show a verdict. */}
        {isScoredType(type) && mode === "QUIZ" && locked && !revealed && (
          <button
            onClick={onReveal}
            className="flex items-center gap-2 px-4 py-2.5 font-mono text-xs font-black uppercase tracking-[0.1em] transition-transform hover:-translate-y-0.5"
            style={{ background: "#22c55e", color: readableOn("#22c55e") }}
          >
            <Eye className="size-3" /> {t("quiz.revealResults")}
          </button>
        )}

        {mode === "QUIZ" && canAdvance && (
          <button
            onClick={onLeaderboard}
            className="flex items-center gap-2 border px-4 py-2.5 font-mono text-xs font-black uppercase tracking-[0.1em] transition-opacity hover:opacity-80"
            style={{ borderColor: theme.accentColor, color: theme.accentColor }}
          >
            <Trophy className="size-3" /> {t("quiz.leaderboard")}
          </button>
        )}

        <span className="flex-1" />

        {canAdvance && (
          <button
            onClick={onNext}
            className="flex items-center gap-2 px-7 py-3 font-mono text-sm font-black uppercase tracking-[0.1em] transition-transform hover:-translate-y-0.5"
            style={{ background: theme.accentColor, color: readableOn(theme.accentColor) }}
          >
            {t("quiz.nextSlide")} <ChevronRight className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}
