import { t } from "@/content/strings"
import { asMCQ, asNumeric, asTypeAnswer } from "@/lib/quiz-types"
import type { SlideData } from "@/lib/quiz-types"

export function normalizeQuizNickname(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().replace(/\s+/g, " ")
  return normalized.length >= 1 && normalized.length <= 24 ? normalized : null
}

export function slideTimerSeconds(slide: Pick<SlideData, "type" | "config">): number | null {
  if (slide.type === "CONTENT") return null
  const timer = (slide.config as { timerSeconds?: number | null }).timerSeconds
  return typeof timer === "number" && Number.isFinite(timer) && timer > 0 ? timer : null
}

export function correctIndicesForSlide(slide: SlideData): number[] {
  return slide.type === "MCQ" || slide.type === "TRUE_FALSE"
    ? asMCQ(slide.config).correct
    : []
}

// Safe only at reveal time. Callers must keep using redactSlide() for GOTO and
// recovery before currentSlideRevealedAt is set.
export function correctAnswersForSlide(slide: SlideData): string[] {
  const indices = correctIndicesForSlide(slide)
  if (slide.type === "MCQ") {
    const config = asMCQ(slide.config)
    return indices.map((index) => config.options[index]).filter(Boolean)
  }
  if (slide.type === "TRUE_FALSE") {
    return indices.map((index) => t(index === 0 ? "quiz.trueLabel" : "quiz.falseLabel"))
  }
  if (slide.type === "TYPE_ANSWER") return asTypeAnswer(slide.config).accepted.slice(0, 3)
  if (slide.type === "NUMERIC") {
    const config = asNumeric(slide.config)
    return [`${config.target}${config.unit ? ` ${config.unit}` : ""}`]
  }
  return []
}

export function secondsUntil(deadline: Date | null, now = new Date()): number | null {
  return deadline ? Math.max(0, (deadline.getTime() - now.getTime()) / 1000) : null
}
