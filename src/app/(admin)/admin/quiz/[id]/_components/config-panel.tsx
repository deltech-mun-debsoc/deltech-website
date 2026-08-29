"use client"

import { Plus, Trash2, Timer } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"
import {
  type SlideData,
  type SlideMode,
  type MCQLayout,
  type OpenTextLayout,
  asMCQ, asWordCloud, asScale, asOpenText, asContent, asTypeAnswer, asNumeric,
  isScoredType,
  DEFAULT_BASE_POINTS_LABEL,
} from "@/lib/quiz-types"

const TIMER_OPTIONS = [null, 10, 15, 20, 30, 45, 60, 90, 120]

function TimerField({
  value,
  onChange,
}: {
  value: number | null
  onChange: (v: number | null) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Timer className="size-3.5 shrink-0 text-muted-foreground" />
      <Label className="text-xs text-muted-foreground flex-1">{t("quiz.builder.timer")}</Label>
      <Select
        value={value === null ? "none" : String(value)}
        onValueChange={(v) => {
          if (v !== null) onChange(v === "none" ? null : Number(v))
        }}
      >
        <SelectTrigger size="sm" className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t("quiz.builder.noTimer")}</SelectItem>
          {TIMER_OPTIONS.filter((o) => o !== null).map((s) => (
            <SelectItem key={s} value={String(s)}>{s}s</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function SwitchRow({
  label,
  checked,
  onCheckedChange,
  id,
}: {
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  id: string
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label htmlFor={id} className="text-sm cursor-pointer select-none">{label}</Label>
      <Switch id={id} size="sm" checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

// ── MCQ config ────────────────────────────────────────────────────────────────

function MCQConfigPanel({
  slide,
  mode,
  onChange,
}: {
  slide: SlideData
  mode: SlideMode
  onChange: (p: Partial<Pick<SlideData, "prompt" | "config">>) => void
}) {
  const cfg = asMCQ(slide.config)

  const setOpt = (i: number, v: string) => {
    const options = [...cfg.options]
    options[i] = v
    onChange({ config: { ...cfg, options } })
  }

  const addOpt = () => {
    if (cfg.options.length >= 10) return
    onChange({ config: { ...cfg, options: [...cfg.options, `Option ${cfg.options.length + 1}`] } })
  }

  const removeOpt = (i: number) => {
    if (cfg.options.length <= 2) return
    const options = cfg.options.filter((_, idx) => idx !== i)
    const correct = cfg.correct.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c))
    onChange({ config: { ...cfg, options, correct } })
  }

  const toggleCorrect = (i: number) => {
    const correct = cfg.correct.includes(i)
      ? cfg.correct.filter((c) => c !== i)
      : [...cfg.correct, i]
    onChange({ config: { ...cfg, correct } })
  }

  return (
    <div className="space-y-4">
      {/* Options */}
      <FieldRow label={t("quiz.slideType.MCQ")}>
        <div className="space-y-1.5">
          {cfg.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {mode === "QUIZ" && (
                <Checkbox
                  id={`opt-${slide.id}-${i}`}
                  checked={cfg.correct.includes(i)}
                  onCheckedChange={() => toggleCorrect(i)}
                  className="shrink-0"
                />
              )}
              <Input
                value={opt}
                onChange={(e) => setOpt(i, e.target.value)}
                placeholder={t("quiz.builder.optionPlaceholder", { n: String(i + 1) })}
                className="h-8 text-sm"
              />
              {cfg.options.length > 2 && (
                <button
                  onClick={() => removeOpt(i)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
          {cfg.options.length < 10 && (
            <Button variant="ghost" size="sm" onClick={addOpt} className="gap-1.5 text-xs w-full">
              <Plus className="size-3.5" />
              {t("quiz.builder.addOption")}
            </Button>
          )}
        </div>
      </FieldRow>

      {mode === "QUIZ" && (
        <p className="text-[11px] text-muted-foreground">
          {t("quiz.builder.correctAnswers")}: check the box(es) next to correct options.
        </p>
      )}

      <Separator />

      {/* Result layout */}
      <FieldRow label={t("quiz.builder.resultLayout")}>
        <Select
          value={cfg.layout}
          onValueChange={(v) => { if (v !== null) onChange({ config: { ...cfg, layout: v as MCQLayout } }) }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["BARS", "DONUT", "PIE", "DOTS"] as MCQLayout[]).map((l) => (
              <SelectItem key={l} value={l}>
                {t(`quiz.builder.layouts.${l}` as Parameters<typeof t>[0])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>

      {mode === "QUIZ" && (
        <TimerField
          value={cfg.timerSeconds}
          onChange={(v) => onChange({ config: { ...cfg, timerSeconds: v } })}
        />
      )}
    </div>
  )
}

// ── WordCloud config ──────────────────────────────────────────────────────────

function WordCloudConfigPanel({
  slide,
  mode,
  onChange,
}: {
  slide: SlideData
  mode: SlideMode
  onChange: (p: Partial<Pick<SlideData, "prompt" | "config">>) => void
}) {
  const cfg = asWordCloud(slide.config)

  return (
    <div className="space-y-4">
      <SwitchRow
        id={`wc-multiple-${slide.id}`}
        label={t("quiz.builder.allowMultiple")}
        checked={cfg.allowMultiple}
        onCheckedChange={(v) => onChange({ config: { ...cfg, allowMultiple: v } })}
      />
      <SwitchRow
        id={`wc-profanity-${slide.id}`}
        label={t("quiz.builder.profanityFilter")}
        checked={cfg.profanityFilter}
        onCheckedChange={(v) => onChange({ config: { ...cfg, profanityFilter: v } })}
      />
      {mode === "QUIZ" && (
        <TimerField
          value={cfg.timerSeconds}
          onChange={(v) => onChange({ config: { ...cfg, timerSeconds: v } })}
        />
      )}
    </div>
  )
}

// ── Scale config ──────────────────────────────────────────────────────────────

function ScaleConfigPanel({
  slide,
  mode,
  onChange,
}: {
  slide: SlideData
  mode: SlideMode
  onChange: (p: Partial<Pick<SlideData, "prompt" | "config">>) => void
}) {
  const cfg = asScale(slide.config)

  const setStmt = (i: number, v: string) => {
    const statements = [...cfg.statements]
    statements[i] = v
    onChange({ config: { ...cfg, statements } })
  }

  const addStmt = () => {
    if (cfg.statements.length >= 8) return
    onChange({ config: { ...cfg, statements: [...cfg.statements, ""] } })
  }

  const removeStmt = (i: number) => {
    if (cfg.statements.length <= 1) return
    onChange({ config: { ...cfg, statements: cfg.statements.filter((_, idx) => idx !== i) } })
  }

  return (
    <div className="space-y-4">
      {/* Range */}
      <FieldRow label={t("quiz.builder.scaleRange")}>
        <div className="flex items-center gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-[11px] text-muted-foreground">Min</Label>
            <Input
              type="number"
              min={1}
              max={cfg.max - 1}
              value={cfg.min}
              onChange={(e) => onChange({ config: { ...cfg, min: Number(e.target.value) } })}
              className="h-8 text-sm"
            />
          </div>
          <span className="pt-5 text-muted-foreground">–</span>
          <div className="flex-1 space-y-1">
            <Label className="text-[11px] text-muted-foreground">Max</Label>
            <Input
              type="number"
              min={cfg.min + 1}
              max={8}
              value={cfg.max}
              onChange={(e) => onChange({ config: { ...cfg, max: Number(e.target.value) } })}
              className="h-8 text-sm"
            />
          </div>
        </div>
      </FieldRow>

      {/* Endpoint labels */}
      <FieldRow label={t("quiz.builder.minLabel")}>
        <Input
          value={cfg.minLabel}
          onChange={(e) => onChange({ config: { ...cfg, minLabel: e.target.value } })}
          placeholder="Strongly disagree"
          className="h-8 text-sm"
        />
      </FieldRow>
      <FieldRow label={t("quiz.builder.maxLabel")}>
        <Input
          value={cfg.maxLabel}
          onChange={(e) => onChange({ config: { ...cfg, maxLabel: e.target.value } })}
          placeholder="Strongly agree"
          className="h-8 text-sm"
        />
      </FieldRow>

      <Separator />

      {/* Statements */}
      <FieldRow label="Statements">
        <div className="space-y-1.5">
          {cfg.statements.map((stmt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={stmt}
                onChange={(e) => setStmt(i, e.target.value)}
                placeholder={t("quiz.builder.statementPlaceholder", { n: String(i + 1) })}
                className="h-8 text-sm"
              />
              {cfg.statements.length > 1 && (
                <button
                  onClick={() => removeStmt(i)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
          {cfg.statements.length < 8 && (
            <Button variant="ghost" size="sm" onClick={addStmt} className="gap-1.5 text-xs w-full">
              <Plus className="size-3.5" />
              {t("quiz.builder.addStatement")}
            </Button>
          )}
        </div>
      </FieldRow>

      {mode === "QUIZ" && (
        <TimerField
          value={cfg.timerSeconds}
          onChange={(v) => onChange({ config: { ...cfg, timerSeconds: v } })}
        />
      )}
    </div>
  )
}

// ── OpenText config ───────────────────────────────────────────────────────────

// ── True / false ─────────────────────────────────────────────────────────────
//
// A two-option MCQ underneath, so the tally, the reveal and the projected chart
// all work unchanged. The builder just does not make anyone type "True" and
// "False" every time.
function TrueFalseConfigPanel({
  slide, mode, onChange,
}: {
  slide: SlideData
  mode: SlideMode
  onChange: (p: Partial<Pick<SlideData, "prompt" | "config">>) => void
}) {
  const cfg = asMCQ(slide.config)
  const correct = cfg.correct[0] ?? null

  return (
    <div className="space-y-4">
      {mode === "QUIZ" && (
        <FieldRow label={t("quiz.correctAnswer")}>
          <div className="flex gap-2">
            {[0, 1].map((index) => (
              <Button
                key={index}
                type="button"
                size="sm"
                variant={correct === index ? "default" : "outline"}
                onClick={() => onChange({ config: { ...cfg, correct: [index] } })}
              >
                {t(index === 0 ? "quiz.trueLabel" : "quiz.falseLabel")}
              </Button>
            ))}
          </div>
        </FieldRow>
      )}

      <TimerField
        value={cfg.timerSeconds}
        onChange={(v) => onChange({ config: { ...cfg, timerSeconds: v } })}
      />

      {mode === "QUIZ" && <ScoringFields cfg={cfg} onChange={onChange} />}
    </div>
  )
}

// ── Type the answer ──────────────────────────────────────────────────────────
function TypeAnswerConfigPanel({
  slide, mode, onChange,
}: {
  slide: SlideData
  mode: SlideMode
  onChange: (p: Partial<Pick<SlideData, "prompt" | "config">>) => void
}) {
  const cfg = asTypeAnswer(slide.config)

  return (
    <div className="space-y-4">
      <FieldRow label={t("quiz.acceptedAnswersLabel")}>
        <div className="space-y-1.5">
          <Textarea
            value={cfg.accepted.join("\n")}
            onChange={(e) =>
              onChange({ config: { ...cfg, accepted: e.target.value.split("\n") } })
            }
            rows={3}
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground">{t("quiz.acceptedAnswersHelp")}</p>
        </div>
      </FieldRow>

      <div className="flex items-center gap-2">
        <Checkbox
          id="exact-match"
          checked={cfg.exact}
          onCheckedChange={(v) => onChange({ config: { ...cfg, exact: v === true } })}
        />
        <Label htmlFor="exact-match" className="text-xs font-normal">
          {t("quiz.exactMatchLabel")}
        </Label>
      </div>

      <TimerField
        value={cfg.timerSeconds}
        onChange={(v) => onChange({ config: { ...cfg, timerSeconds: v } })}
      />

      {mode === "QUIZ" && <ScoringFields cfg={cfg} onChange={onChange} />}
    </div>
  )
}

// ── Numeric ──────────────────────────────────────────────────────────────────
function NumericConfigPanel({
  slide, mode, onChange,
}: {
  slide: SlideData
  mode: SlideMode
  onChange: (p: Partial<Pick<SlideData, "prompt" | "config">>) => void
}) {
  const cfg = asNumeric(slide.config)

  return (
    <div className="space-y-4">
      <FieldRow label={t("quiz.targetLabel")}>
        <Input
          type="number"
          value={cfg.target}
          onChange={(e) => onChange({ config: { ...cfg, target: Number(e.target.value) } })}
          className="h-8 w-32 text-sm"
        />
      </FieldRow>

      <FieldRow label={t("quiz.toleranceLabel")}>
        <Input
          type="number"
          min={0}
          value={cfg.tolerance}
          onChange={(e) =>
            onChange({ config: { ...cfg, tolerance: Math.max(0, Number(e.target.value)) } })
          }
          className="h-8 w-32 text-sm"
        />
      </FieldRow>

      <FieldRow label={t("quiz.unitLabel")}>
        <Input
          value={cfg.unit}
          onChange={(e) => onChange({ config: { ...cfg, unit: e.target.value } })}
          className="h-8 w-32 text-sm"
        />
      </FieldRow>

      <TimerField
        value={cfg.timerSeconds}
        onChange={(v) => onChange({ config: { ...cfg, timerSeconds: v } })}
      />

      {mode === "QUIZ" && <ScoringFields cfg={cfg} onChange={onChange} />}
    </div>
  )
}

// ── Scoring, shared by every scored type ─────────────────────────────────────
//
// Every field is optional and blank means "use the default", so an existing
// slide keeps scoring exactly as it did: 1000 points, half-weight speed bonus,
// no streak.
function ScoringFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>
  onChange: (p: Partial<Pick<SlideData, "prompt" | "config">>) => void
}) {
  const base = cfg.basePoints as number | undefined
  const weight = cfg.speedWeight as number | undefined
  const streak = cfg.streakBonus as number | undefined
  const partial = cfg.partialCredit as boolean | undefined
  const allowMultiple = cfg.allowMultiple as boolean | undefined

  return (
    <>
      <Separator />
      <p className="data-label text-muted-foreground">{t("quiz.scoringTitle")}</p>

      <FieldRow label={t("quiz.basePointsLabel")}>
        <Input
          type="number"
          min={0}
          placeholder={DEFAULT_BASE_POINTS_LABEL}
          value={base ?? ""}
          onChange={(e) =>
            onChange({
              config: {
                ...cfg,
                basePoints: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)),
              } as never,
            })
          }
          className="h-8 w-28 text-sm"
        />
      </FieldRow>

      <FieldRow label={t("quiz.speedWeightLabel")}>
        <div className="space-y-1.5">
          <Input
            type="number"
            min={0}
            max={1}
            step={0.1}
            placeholder="0.5"
            value={weight ?? ""}
            onChange={(e) =>
              onChange({
                config: {
                  ...cfg,
                  speedWeight:
                    e.target.value === ""
                      ? undefined
                      : Math.min(1, Math.max(0, Number(e.target.value))),
                } as never,
              })
            }
            className="h-8 w-28 text-sm"
          />
          <p className="text-xs text-muted-foreground">{t("quiz.speedWeightHelp")}</p>
        </div>
      </FieldRow>

      <FieldRow label={t("quiz.streakBonusLabel")}>
        <Input
          type="number"
          min={0}
          placeholder="0"
          value={streak ?? ""}
          onChange={(e) =>
            onChange({
              config: {
                ...cfg,
                streakBonus: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)),
              } as never,
            })
          }
          className="h-8 w-28 text-sm"
        />
      </FieldRow>

      {allowMultiple && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="partial-credit"
            checked={partial !== false}
            onCheckedChange={(v) =>
              onChange({ config: { ...cfg, partialCredit: v === true } as never })
            }
          />
          <Label htmlFor="partial-credit" className="text-xs font-normal">
            {t("quiz.partialCreditLabel")}
          </Label>
        </div>
      )}
    </>
  )
}

function OpenTextConfigPanel({
  slide,
  mode,
  onChange,
}: {
  slide: SlideData
  mode: SlideMode
  onChange: (p: Partial<Pick<SlideData, "prompt" | "config">>) => void
}) {
  const cfg = asOpenText(slide.config)

  return (
    <div className="space-y-4">
      <FieldRow label={t("quiz.builder.maxChars")}>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={10}
            max={200}
            value={cfg.maxLength}
            onChange={(e) => {
              const v = Math.min(200, Math.max(10, Number(e.target.value)))
              onChange({ config: { ...cfg, maxLength: v } })
            }}
            className="h-8 w-24 text-sm"
          />
          <span className="text-xs text-muted-foreground">/ 200 max</span>
        </div>
      </FieldRow>

      <FieldRow label={t("quiz.builder.responseLayout")}>
        <Select
          value={cfg.layout}
          onValueChange={(v) => { if (v !== null) onChange({ config: { ...cfg, layout: v as OpenTextLayout } }) }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["SPEECH_BUBBLES", "FLOWING_GRID"] as OpenTextLayout[]).map((l) => (
              <SelectItem key={l} value={l}>
                {t(`quiz.builder.layouts.${l}` as Parameters<typeof t>[0])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>

      {mode === "QUIZ" && (
        <TimerField
          value={cfg.timerSeconds}
          onChange={(v) => onChange({ config: { ...cfg, timerSeconds: v } })}
        />
      )}
    </div>
  )
}

// ── Content config ────────────────────────────────────────────────────────────

function ContentConfigPanel({
  slide,
  onChange,
}: {
  slide: SlideData
  onChange: (p: Partial<Pick<SlideData, "prompt" | "config">>) => void
}) {
  const cfg = asContent(slide.config)

  return (
    <div className="space-y-4">
      <FieldRow label="Body text">
        <Textarea
          value={cfg.body}
          onChange={(e) => onChange({ config: { ...cfg, body: e.target.value } })}
          placeholder={t("quiz.builder.bodyPlaceholder")}
          rows={5}
          className="resize-none text-sm"
        />
      </FieldRow>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  slide: SlideData | null
  mode: SlideMode
  onChange: (slideId: string, patch: Partial<Pick<SlideData, "prompt" | "config">>) => void
  className?: string
}

export function ConfigPanel({ slide, mode, onChange, className }: Props) {
  if (!slide) {
    return (
      <aside className={cn("admin-rail flex shrink-0 items-center justify-center border-l bg-background", className)}>
        <p className="text-base text-muted-foreground">Select a slide to configure</p>
      </aside>
    )
  }

  const handleChange = (patch: Partial<Pick<SlideData, "prompt" | "config">>) =>
    onChange(slide.id, patch)

  return (
    <aside className={cn("admin-rail flex shrink-0 flex-col overflow-hidden border-l border-black/15 bg-background", className)}>
      <div className="flex items-center gap-2 border-b px-5 py-5">
        <span className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-primary">
          {t(`quiz.slideType.${slide.type}` as Parameters<typeof t>[0])}
        </span>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {/* Prompt, common to all non-content slides */}
        <FieldRow label="Question / heading">
          <Textarea
            value={slide.prompt}
            onChange={(e) => handleChange({ prompt: e.target.value })}
            placeholder={t("quiz.builder.promptPlaceholder")}
            rows={3}
            className="resize-none text-base leading-relaxed"
          />
        </FieldRow>

        <Separator />

        {slide.type === "MCQ"         && <MCQConfigPanel        slide={slide} mode={mode} onChange={handleChange} />}
        {slide.type === "TRUE_FALSE"  && <TrueFalseConfigPanel  slide={slide} mode={mode} onChange={handleChange} />}
        {slide.type === "TYPE_ANSWER" && <TypeAnswerConfigPanel slide={slide} mode={mode} onChange={handleChange} />}
        {slide.type === "NUMERIC"     && <NumericConfigPanel    slide={slide} mode={mode} onChange={handleChange} />}
        {slide.type === "WORDCLOUD" && <WordCloudConfigPanel slide={slide} mode={mode} onChange={handleChange} />}
        {slide.type === "SCALE"     && <ScaleConfigPanel     slide={slide} mode={mode} onChange={handleChange} />}
        {slide.type === "OPEN_TEXT" && <OpenTextConfigPanel  slide={slide} mode={mode} onChange={handleChange} />}
        {slide.type === "CONTENT"   && <ContentConfigPanel   slide={slide}             onChange={handleChange} />}
      </div>
    </aside>
  )
}
