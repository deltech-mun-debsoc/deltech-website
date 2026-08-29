"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { t, type StringKey } from "@/content/strings"
import { RECOMMENDATIONS_BY_KIND } from "@/lib/schemas/recruitment"
import { validateScores, type EvaluationCriterion } from "@/lib/schemas/recruitment"
import { saveEvaluationDraft, submitEvaluation } from "../evaluation-actions"

export interface ConsoleEvaluation {
  id: string
  evaluatorId: string
  evaluatorRole: string
  evaluatorName: string | null
  evaluatorEmail: string | null
  scores: Record<string, number>
  overall: number | null
  remarks: string | null
  recommendation: string | null
  state: string
  version: number
  submittedAt: string | null
  isMine: boolean
}


// One evaluator's scoring form plus the panel's other scores.
//
// Three things are kept visibly distinct, as the spec requires: this evaluator's own
// score, the panel aggregate, and (elsewhere) the final authorised decision. An
// idempotency key is minted per submit attempt so a network retry collapses onto the
// same row instead of creating a second score.
export function EvaluationForm({
  candidateId,
  candidateName,
  sessionId,
  kind,
  criteria,
  evaluations,
  panelists,
  viewerId,
  canEvaluate,
  canRevise,
  canViewOthers,
  onSaved,
}: {
  cycleId: string
  candidateId: string
  candidateName: string
  sessionId: string | null
  kind: "GD" | "PI"
  criteria: EvaluationCriterion[]
  evaluations: ConsoleEvaluation[]
  panelists: { userId: string; name: string | null; email: string }[]
  viewerId: string
  canEvaluate: boolean
  canRevise: boolean
  canViewOthers: boolean
  onSaved?: () => void
}) {
  const router = useRouter()
  const initialEvaluatorId =
    panelists.some((panelist) => panelist.userId === viewerId) || !canViewOthers
      ? viewerId
      : panelists[0]?.userId ?? viewerId
  const [evaluationUserId, setEvaluationUserId] = useState(initialEvaluatorId)
  const mine = evaluations.find((e) => e.evaluatorId === evaluationUserId)
  const others = evaluations.filter((e) => e.id !== mine?.id)

  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(criteria.map((c) => [c.key, mine?.scores[c.key]?.toString() ?? ""])),
  )
  const [remarks, setRemarks] = useState(mine?.remarks ?? "")
  const [recommendation, setRecommendation] = useState<string | null>(mine?.recommendation ?? null)

  useEffect(() => {
    setScores(Object.fromEntries(criteria.map((c) => [c.key, mine?.scores[c.key]?.toString() ?? ""])))
    setRemarks(mine?.remarks ?? "")
    setRecommendation(mine?.recommendation ?? null)
  }, [criteria, evaluationUserId, mine?.id])

  function switchEvaluator(userId: string) {
    const next = evaluations.find((evaluation) => evaluation.evaluatorId === userId)
    setEvaluationUserId(userId)
    setScores(
      Object.fromEntries(criteria.map((criterion) => [criterion.key, next?.scores[criterion.key]?.toString() ?? ""])),
    )
    setRemarks(next?.remarks ?? "")
    setRecommendation(next?.recommendation ?? null)
  }

  const recommendationItems = useMemo(
    () =>
      Object.fromEntries(
        RECOMMENDATIONS_BY_KIND[kind].map((r) => [r, t(`recruitment.recommendation.${r}` as StringKey)]),
      ),
    [kind],
  )
  const [pending, startTransition] = useTransition()

  const numericScores = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(scores)
          .filter(([, v]) => v !== "")
          .map(([k, v]) => [k, Number(v)]),
      ),
    [scores],
  )

  // Same validator the server uses, so the preview and the accepted value agree.
  const validation = useMemo(
    () => validateScores(numericScores, criteria, { requireAll: true }),
    [numericScores, criteria],
  )

  const submitted = mine?.state === "SUBMITTED"
  const locked = submitted && !canRevise

  // Panel aggregate across submitted scores, this evaluator's included.
  const aggregate = useMemo(() => {
    const visibleEvaluations = canViewOthers ? evaluations : mine ? [mine] : []
    const live = visibleEvaluations.filter((e) => e.state === "SUBMITTED" && e.overall !== null)
    if (live.length === 0) return null
    return Number((live.reduce((a, e) => a + (e.overall ?? 0), 0) / live.length).toFixed(2))
  }, [canViewOthers, evaluations, mine])

  function save(mode: "draft" | "submit") {
    startTransition(async () => {
      const payload = {
        candidateId,
        sessionId,
        scores: numericScores,
        remarks: remarks.trim() || undefined,
        recommendation: (recommendation || undefined) as
          | "SELECT"
          | "HOLD"
          | "REJECT"
          | undefined,
        panelistUserId: evaluationUserId,
        // Derived from the evaluator, candidate, session and content: a retry of
        // the SAME submission reuses it; a genuine revision produces a new one.
        idempotencyKey:
          mode === "submit"
            ? `ev:${evaluationUserId}:${candidateId}:${sessionId ?? "none"}:${(mine?.version ?? 0) + 1}`
            : undefined,
        expectedVersion: mine?.version,
      }
      const result =
        mode === "submit" ? await submitEvaluation(payload) : await saveEvaluationDraft(payload)

      if (!result.ok) {
        toast.error(result.error)
        result.errors?.slice(0, 3).forEach((e) => toast.error(e))
        return
      }
      toast.success(
        mode === "submit" ? t("recruitment.evaluation.submitted") : t("recruitment.evaluation.draft"),
      )
      onSaved?.()
      router.refresh()
    })
  }

  return (
    <div className="space-y-4 rounded-md border border-border/70 bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="data-label text-muted-foreground">
          {t("recruitment.evaluation.title")}
        </p>
        <div className="flex items-center gap-3 text-xs">
          {mine?.overall != null && (
            <span>
              {t("recruitment.evaluation.yourScore")}:{" "}
              <strong className="font-mono tabular-nums">
                {t("recruitment.evaluation.overallOutOf", { score: mine.overall })}
              </strong>
            </span>
          )}
          {aggregate != null && (
            <span className="text-muted-foreground">
              {t("recruitment.evaluation.aggregate")}:{" "}
              <strong className="font-mono tabular-nums">
                {t("recruitment.evaluation.overallOutOf", { score: aggregate })}
              </strong>{" "}
              ({t("recruitment.evaluation.evaluators", { count: evaluations.filter((e) => e.state === "SUBMITTED").length })})
            </span>
          )}
        </div>
      </div>

      {kind === "GD" && canEvaluate && canViewOthers && panelists.length > 0 && (
        <div className="space-y-2 rounded-md border border-border/70 bg-background p-3">
          <div>
            <p className="text-sm font-medium">{t("recruitment.evaluation.panelistDeviceTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {t("recruitment.evaluation.panelistDeviceDescription")}
            </p>
          </div>
          <select
            value={evaluationUserId}
            onChange={(event) => switchEvaluator(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm sm:w-72"
            aria-label={t("recruitment.evaluation.panelistDeviceTitle")}
          >
            {panelists.map((panelist) => (
              <option key={panelist.userId} value={panelist.userId}>
                {panelist.name ?? panelist.email}
              </option>
            ))}
          </select>
        </div>
      )}

      {canEvaluate ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {criteria.map((c) => (
              <div key={c.key} className="space-y-1.5">
                <Label htmlFor={`sc-${candidateId}-${c.key}`} className="text-xs">
                  {c.label} · {t("recruitment.control.criterionMax")} {c.max}
                </Label>
                <Input
                  id={`sc-${candidateId}-${c.key}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={c.max}
                  step="0.5"
                  value={scores[c.key] ?? ""}
                  disabled={locked || pending}
                  onChange={(e) => setScores((prev) => ({ ...prev, [c.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <div className="space-y-1.5">
              <Label htmlFor={`rm-${candidateId}`} className="text-xs">
                {t("recruitment.evaluation.remarksLabel")}
              </Label>
              <Textarea
                id={`rm-${candidateId}`}
                rows={2}
                value={remarks}
                disabled={locked || pending}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder={t("recruitment.evaluation.remarksPlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("recruitment.evaluation.recommendationLabel")}</Label>
              {/* `items` is what lets the trigger render a LABEL. Base UI's
                  Select.Item does not register its label with the trigger, so
                  without this the trigger shows the raw enum ("ADVANCE"). */}
              <Select
                items={recommendationItems}
                value={recommendation}
                onValueChange={(value) => setRecommendation((value as string | null) ?? null)}
                disabled={locked || pending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("recruitment.evaluation.recommendationPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {RECOMMENDATIONS_BY_KIND[kind].map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`recruitment.recommendation.${r}` as StringKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {submitted && t("recruitment.evaluation.revisedNote")}
              {!validation.ok &&
                Object.keys(numericScores).length > 0 &&
                validation.errors[0]}
            </p>
            <div className="flex items-center gap-2">
              {!submitted && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending || Object.keys(numericScores).length === 0}
                  onClick={() => save("draft")}
                >
                  {t("recruitment.evaluation.saveDraft")}
                </Button>
              )}
              <Button
                size="sm"
                disabled={pending || locked || !validation.ok || !recommendation}
                onClick={() => save("submit")}
              >
                {submitted ? t("recruitment.evaluation.revise") : t("recruitment.evaluation.submit")}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("recruitment.evaluation.ownOnly")}
        </p>
      )}

      {/* Other evaluators' scores, with full attribution. Withheld from a JC so the
          panel forms independent judgements. */}
      {canViewOthers && others.length > 0 && (
        <ul className="space-y-2 border-t border-border/70 pt-3">
          {others.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-2 text-xs">
              <Badge className="bg-secondary font-normal text-secondary-foreground">
                {t(`recruitment.evaluation.${e.state === "SUBMITTED" ? "submitted" : "draft"}` as StringKey)}
              </Badge>
              <span className="font-mono tabular-nums">
                {e.overall != null ? t("recruitment.evaluation.overallOutOf", { score: e.overall }) : ", "}
              </span>
              <span className="text-muted-foreground">
                {t("recruitment.evaluation.submittedBy", {
                  name: e.evaluatorName ?? e.evaluatorEmail ?? e.evaluatorId,
                })}
              </span>
              {e.recommendation && (
                <span className="text-muted-foreground">
                  · {t(`recruitment.recommendation.${e.recommendation}` as StringKey)}
                </span>
              )}
              {e.remarks && <span className="w-full text-muted-foreground">{e.remarks}</span>}
            </li>
          ))}
        </ul>
      )}

      {evaluations.length === 0 && !canEvaluate && (
        <p className="text-xs text-muted-foreground">{t("recruitment.evaluation.noneYet")}</p>
      )}

      {/* Named so the console can label the section for screen readers. */}
      <span className="sr-only">{candidateName}</span>
    </div>
  )
}
