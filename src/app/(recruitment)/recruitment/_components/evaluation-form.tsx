"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Check, Loader2 } from "lucide-react"
import { t, type StringKey } from "@/content/strings"
import { RECOMMENDATIONS_BY_KIND } from "@/lib/schemas/recruitment"
import { validateScores, type EvaluationCriterion } from "@/lib/schemas/recruitment"
import { newerOf } from "@/lib/recruitment/evaluation-merge"
import { saveEvaluationDraft, submitEvaluation, type SavedEvaluation } from "../evaluation-actions"

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
  viewerId,
  canEvaluate,
  canRevise,
  canViewOthers,
  onSaved,
  onRevised,
}: {
  cycleId: string
  candidateId: string
  candidateName: string
  sessionId: string | null
  kind: "GD" | "PI"
  criteria: EvaluationCriterion[]
  evaluations: ConsoleEvaluation[]
  viewerId: string
  canEvaluate: boolean
  canRevise: boolean
  canViewOthers: boolean
  onSaved?: () => void
  // Fired only after a successful revision. The interview console uses it to
  // return to the queue; a GD console passes nothing, because a panel of several
  // candidates may be revised in any order and being thrown out of the page after
  // each one would be worse than the extra click.
  onRevised?: () => void
}) {
  const router = useRouter()
  // You score as yourself, always.
  //
  // There used to be a "Whose evaluation is this?" picker here, so one operator on
  // a shared panel laptop could record a score on another panelist's behalf. In
  // practice a single person drives the site while the rest of the panel deliberate
  // off it, so the picker was a one-entry dropdown of raw email addresses guarding a
  // delegated write nobody made. Who sat on the panel is still recorded -- that is
  // the group's staff roster, shown on the dossier and the group list -- it just is
  // not a thing you switch between mid-session.
  const serverMine = evaluations.find((e) => e.evaluatorId === viewerId)
  const others = evaluations.filter((e) => e.id !== serverMine?.id)

  // The row the server last confirmed to THIS client, values included.
  //
  // Without it the form's only source of truth is the RSC payload, and a
  // revision always mints a new row id -- so a refresh that had not yet seen the
  // write would re-seed every field from the pre-write row and visibly undo the
  // save. Adopting the returned row is the same thing SessionControls does with
  // the session every action hands back.
  const [adopted, setAdopted] = useState<ConsoleEvaluation | null>(null)

  // Whichever version is newer wins, so a legitimate refresh (another evaluator,
  // a later revision from a second tab) is never ignored, and a stale one never
  // clobbers what this client just saved. The rule is pure and unit-checked.
  const mine = newerOf(adopted, serverMine ?? null)

  // Build the adoptable row from what the server confirmed plus the values this
  // client sent: the server does not echo scores back, and it does not need to.
  function adopt(
    saved: SavedEvaluation,
    sent: { scores: Record<string, number>; remarks: string | null; recommendation: string | null },
  ) {
    setAdopted({
      id: saved.id,
      evaluatorId: viewerId,
      evaluatorRole: serverMine?.evaluatorRole ?? "",
      evaluatorName: serverMine?.evaluatorName ?? null,
      evaluatorEmail: serverMine?.evaluatorEmail ?? null,
      scores: sent.scores,
      overall: saved.overall,
      remarks: sent.remarks,
      recommendation: sent.recommendation,
      state: saved.state,
      version: saved.version,
      submittedAt: saved.submittedAt,
      isMine: true,
    })
  }

  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(criteria.map((c) => [c.key, mine?.scores[c.key]?.toString() ?? ""])),
  )
  const [remarks, setRemarks] = useState(mine?.remarks ?? "")
  const [recommendation, setRecommendation] = useState<string | null>(mine?.recommendation ?? null)

  useEffect(() => {
    setScores(Object.fromEntries(criteria.map((c) => [c.key, mine?.scores[c.key]?.toString() ?? ""])))
    setRemarks(mine?.remarks ?? "")
    setRecommendation(mine?.recommendation ?? null)
  }, [criteria, mine?.id])

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

  // Autosave.
  //
  // Scoring a group used to mean pressing Submit once per candidate before Finish
  // would accept the session -- eight taps for a group of seven, and a refusal if
  // you missed one. Now the score saves itself as a draft while you type, and
  // finishing the session promotes every complete draft. The only thing left to
  // press is Finish.
  //
  // Submitted work is NOT autosaved: revising a score that a panel already agreed
  // is a deliberate act, so it keeps an explicit button.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const autosave = useCallback(() => {
    if (submitted || !canEvaluate) return
    if (Object.keys(numericScores).length === 0 && !remarks.trim() && !recommendation) return
    setSaveState("saving")
    void saveEvaluationDraft({
      candidateId,
      sessionId,
      scores: numericScores,
      remarks: remarks.trim() || undefined,
      recommendation: (recommendation || undefined) as "SELECT" | "HOLD" | "REJECT" | undefined,
      expectedVersion: mine?.version,
    })
      .then((result) => {
        if (!result.ok) {
          setSaveState("idle")
          toast.error(result.error)
          return
        }
        adopt(result.saved, {
          scores: numericScores,
          remarks: remarks.trim() || null,
          recommendation: recommendation || null,
        })
        dirtyRef.current = false
        setSaveState("saved")
        onSaved?.()
      })
      .catch(() => setSaveState("idle"))
  }, [
    submitted, canEvaluate, numericScores, remarks, recommendation,
    candidateId, sessionId, mine?.version, onSaved,
  ])

  useEffect(() => {
    if (!dirtyRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(autosave, 800)
    return () => clearTimeout(timerRef.current)
  }, [autosave])

  // Nothing typed yet must not count as an edit, or every mount would save.
  const touch = () => { dirtyRef.current = true; setSaveState("idle") }

  // Exactly the server's test for "complete enough to submit when the session
  // finishes", so the console never promises something finish would skip.
  const ready = validation.ok && Boolean(recommendation)

  // Has anything actually changed since the row the server last confirmed?
  //
  // Revise used to supersede the row and write a fresh version plus an audit
  // event even when nothing differed, which filled the trail with revisions that
  // revised nothing and buried the real ones.
  function unchanged(): boolean {
    if (!mine) return false
    const sameScores =
      criteria.every((c) => (mine.scores[c.key] ?? null) === (numericScores[c.key] ?? null))
    const sameRemarks = (mine.remarks ?? "") === remarks.trim()
    const sameRecommendation = (mine.recommendation ?? null) === (recommendation || null)
    return sameScores && sameRemarks && sameRecommendation
  }

  // Revising an already-submitted score. A first score never comes through here:
  // it autosaves as a draft and is submitted when the session finishes.
  function save() {
    if (unchanged()) {
      toast.info(t("recruitment.evaluation.noChanges"))
      onRevised?.()
      return
    }
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
        // Derived from the evaluator, candidate, session and content: a retry of
        // the SAME submission reuses it; a genuine revision produces a new one.
        idempotencyKey: `ev:${viewerId}:${candidateId}:${sessionId ?? "none"}:${(mine?.version ?? 0) + 1}`,
        expectedVersion: mine?.version,
      }
      const result = await submitEvaluation(payload)

      if (!result.ok) {
        toast.error(result.error)
        result.errors?.slice(0, 3).forEach((e) => toast.error(e))
        return
      }
      // Adopt before refreshing: the screen is then correct whether or not the
      // refresh has seen the write yet.
      adopt(result.saved, {
        scores: numericScores,
        remarks: remarks.trim() || null,
        recommendation: recommendation || null,
      })
      toast.success(t("recruitment.evaluation.submitted"))
      onSaved?.()
      router.refresh()
      onRevised?.()
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
                  onChange={(e) => {
                    touch()
                    setScores((prev) => ({ ...prev, [c.key]: e.target.value }))
                  }}
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
                onChange={(e) => { touch(); setRemarks(e.target.value) }}
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
                onValueChange={(value) => {
                  touch()
                  setRecommendation((value as string | null) ?? null)
                }}
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
            {/* Whatever state this form is in, it says so. A disabled control
                that explains nothing is exactly how Skip GD and Hold were
                reported as broken when they were merely gated. */}
            <p className="text-xs text-muted-foreground">
              {locked
                ? t("recruitment.evaluation.lockedNote")
                : submitted && !validation.ok
                  ? t("recruitment.evaluation.needsScores")
                  : submitted && !recommendation
                    ? t("recruitment.evaluation.needsRecommendation")
                    : submitted
                      ? t("recruitment.evaluation.revisedNote")
                      : !validation.ok && Object.keys(numericScores).length > 0
                        ? validation.errors[0]
                        : null}
            </p>

            <div className="flex items-center gap-3">
              {/* What the panel needs to know is whether their score is safe, not
                  which button to press. Complete scores say so; an incomplete one
                  says what is still missing, because finishing will skip it. */}
              {!submitted && (
                <span
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  aria-live="polite"
                >
                  {saveState === "saving" && (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      {t("recruitment.evaluation.saving")}
                    </>
                  )}
                  {saveState === "saved" && ready && (
                    <>
                      <Check className="size-3 text-teal-600" />
                      {t("recruitment.evaluation.readyToFinish")}
                    </>
                  )}
                  {saveState === "saved" && !ready && t("recruitment.evaluation.savedIncomplete")}
                </span>
              )}

              {/* Only a revision needs a button. A first score is saved as you type
                  and submitted when the session finishes. */}
              {submitted && (
                <Button
                  size="sm"
                  disabled={pending || locked || !validation.ok || !recommendation}
                  onClick={() => save()}
                >
                  {pending && <Loader2 className="mr-1.5 size-3 animate-spin" />}
                  {t("recruitment.evaluation.revise")}
                </Button>
              )}
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
