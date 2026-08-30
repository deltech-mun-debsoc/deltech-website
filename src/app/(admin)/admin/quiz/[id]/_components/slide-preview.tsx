"use client"

import { t } from "@/content/strings"
import {
  type SlideData,
  type PresentationTheme,
  asMCQ, asWordCloud, asScale, asOpenText, asContent, asTypeAnswer, asNumeric,
} from "@/lib/quiz-types"

interface Props {
  slide: SlideData
  theme: PresentationTheme
}

export function SlidePreview({ slide, theme }: Props) {
  const style = {
    background: theme.background,
    color: theme.textColor,
    fontFamily: theme.font === "Georgia" ? "Georgia, serif" : `${theme.font}, Inter, sans-serif`,
  }

  return (
    <div
      className="w-full max-w-3xl overflow-hidden shadow-[18px_18px_0_rgba(17,22,20,0.2)]"
      style={{ aspectRatio: "16/9", ...style }}
    >
      <div className="flex h-full flex-col p-12">
        <PreviewContent slide={slide} theme={theme} />
      </div>
    </div>
  )
}

function PreviewContent({ slide, theme }: Props) {
  const accent = theme.accentColor

  switch (slide.type) {
    case "MCQ": {
      const cfg = asMCQ(slide.config)
      return (
        <>
          <Prompt text={slide.prompt} />
          <div className="mt-auto space-y-2">
            {cfg.options.map((opt, i) => (
              <div key={i} className="flex items-center gap-3">
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  style={{ background: accent, color: theme.background }}
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <div className="flex-1 rounded-lg px-3 py-2 text-sm" style={{ background: `${accent}22` }}>
                  {opt || <span style={{ opacity: 0.35 }}>Option {i + 1}</span>}
                </div>
                <span className="text-xs font-mono" style={{ opacity: 0.4 }}>0%</span>
              </div>
            ))}
          </div>
        </>
      )
    }

    case "WORDCLOUD": {
      const SAMPLE = ["Leadership", "Innovation", "Teamwork", "Growth", "Vision", "Change", "Ideas"]
      const sizes = [32, 20, 26, 16, 22, 18, 14]
      return (
        <>
          <Prompt text={slide.prompt} />
          <div className="mt-auto flex flex-wrap items-end justify-center gap-x-4 gap-y-1">
            {SAMPLE.map((w, i) => (
              <span key={w} style={{ fontSize: sizes[i], color: accent, opacity: 0.55 + i * 0.05 }}>
                {w}
              </span>
            ))}
          </div>
        </>
      )
    }

    case "SCALE": {
      const cfg = asScale(slide.config)
      const ticks = Array.from({ length: cfg.max - cfg.min + 1 }, (_, i) => cfg.min + i)
      return (
        <>
          <Prompt text={slide.prompt} />
          {cfg.statements.length > 0 && (
            <div className="mt-6 space-y-4">
              {cfg.statements.slice(0, 3).map((stmt, i) => (
                <div key={i} className="space-y-1.5">
                  <p className="text-xs font-medium" style={{ opacity: 0.7 }}>{stmt || `Statement ${i + 1}`}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px]" style={{ opacity: 0.5 }}>{cfg.minLabel}</span>
                    <div className="relative flex-1 h-1.5 rounded-full" style={{ background: `${accent}33` }}>
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: "45%", background: accent }}
                      />
                    </div>
                    <span className="text-[10px]" style={{ opacity: 0.5 }}>{cfg.maxLabel}</span>
                  </div>
                  <div className="flex justify-between px-[30px]">
                    {ticks.map((t) => (
                      <span key={t} className="text-[9px]" style={{ opacity: 0.4 }}>{t}</span>
                    ))}
                  </div>
                </div>
              ))}
              {cfg.statements.length > 3 && (
                <p className="text-[10px]" style={{ opacity: 0.4 }}>+{cfg.statements.length - 3} more…</p>
              )}
            </div>
          )}
        </>
      )
    }

    case "OPEN_TEXT": {
      const cfg = asOpenText(slide.config)
      return (
        <>
          <Prompt text={slide.prompt} />
          <div className="mt-auto">
            {cfg.layout === "SPEECH_BUBBLES" ? (
              <div className="flex flex-wrap gap-2">
                {["Great idea!", "I agree", "Interesting!", "Very helpful"].map((s) => (
                  <span
                    key={s}
                    className="rounded-full px-3 py-1.5 text-xs"
                    style={{ background: `${accent}22`, border: `1px solid ${accent}44` }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {["Great idea!", "I agree", "Interesting!", "Very helpful", "Excellent", "Noted"].map((s) => (
                  <span
                    key={s}
                    className="rounded-lg px-2 py-1.5 text-[10px]"
                    style={{ background: `${accent}22` }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-2 text-[10px]" style={{ opacity: 0.35 }}>Max {cfg.maxLength} chars</p>
          </div>
        </>
      )
    }

    // The three scored formats added alongside MCQ had no case here at all, so
    // picking one left the builder's canvas blank -- the one panel whose whole
    // job is to show what the room will see.
    case "TRUE_FALSE": {
      const cfg = asMCQ(slide.config)
      return (
        <>
          <Prompt text={slide.prompt} />
          <div className="mt-auto grid grid-cols-2 gap-4">
            {(cfg.options.length ? cfg.options : ["True", "False"]).slice(0, 2).map((opt, i) => (
              <div
                key={i}
                className="flex items-center justify-center rounded-xl py-6 text-2xl font-bold"
                style={{
                  background: `${accent}22`,
                  // The correct answer is marked in the builder, where only the
                  // author is looking. It is stripped before broadcast.
                  outline: cfg.correct.includes(i) ? `3px solid ${accent}` : "none",
                }}
              >
                {opt}
              </div>
            ))}
          </div>
        </>
      )
    }

    case "TYPE_ANSWER": {
      const cfg = asTypeAnswer(slide.config)
      const accepted = cfg.accepted.filter(Boolean)
      return (
        <>
          <Prompt text={slide.prompt} />
          <div className="mt-auto space-y-3">
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{ background: `${accent}18`, border: `1px dashed ${accent}` }}
            >
              <span style={{ opacity: 0.45 }}>{t("quiz.typeAnswerPlaceholder")}</span>
            </div>
            <p className="text-xs" style={{ opacity: 0.5 }}>
              {accepted.length
                ? `${t("quiz.builder.acceptedAnswers")}: ${accepted.join(", ")}`
                : t("quiz.builder.acceptedAnswersEmpty")}
            </p>
          </div>
        </>
      )
    }

    case "NUMERIC": {
      const cfg = asNumeric(slide.config)
      return (
        <>
          <Prompt text={slide.prompt} />
          <div className="mt-auto space-y-3">
            <div className="flex items-baseline justify-center gap-2">
              <span className="text-5xl font-bold tabular-nums" style={{ color: accent }}>
                {cfg.target}
              </span>
              {cfg.unit && <span className="text-xl" style={{ opacity: 0.55 }}>{cfg.unit}</span>}
            </div>
            <p className="text-center text-xs" style={{ opacity: 0.5 }}>
              {cfg.tolerance > 0
                ? t("quiz.builder.numericTolerance", { n: cfg.tolerance })
                : t("quiz.builder.numericExact")}
            </p>
          </div>
        </>
      )
    }

    case "CONTENT": {
      const cfg = asContent(slide.config)
      return (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <p className="text-3xl font-bold leading-tight" style={{ fontFamily: "inherit" }}>
            {slide.prompt || <span style={{ opacity: 0.25 }}>Heading</span>}
          </p>
          {cfg.body && (
            <p className="mt-4 text-base leading-relaxed" style={{ opacity: 0.65 }}>
              {cfg.body}
            </p>
          )}
        </div>
      )
    }
  }
}

function Prompt({ text }: { text: string }) {
  return (
    <p className="text-3xl font-bold leading-tight">
      {text || <span style={{ opacity: 0.25 }}>Your question…</span>}
    </p>
  )
}
