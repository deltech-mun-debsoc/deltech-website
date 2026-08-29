import { notFound, redirect } from "next/navigation"
import { FastForward, Info } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { resolveCycleContext } from "@/lib/recruitment/authz"
import { can } from "@/lib/recruitment/permissions"
import { getCandidateDossier, type DossierEvaluation, type DossierSession } from "@/lib/recruitment/dossier"
import { formatElapsed } from "@/lib/recruitment/session"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { t, type StringKey } from "@/content/strings"
import { RecruitmentPageHeader } from "../../../_components/page-header"
import { ResultBadge, StageBadge } from "../../../_components/status-badges"

// The PI handoff dossier: profile, imported response, full recruitment history, GD
// record with every evaluator's score, and the aggregate, plus an explicit answer
// to "why is there no GD data?" for direct-to-PI candidates.
export default async function CandidateDossierPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const candidate = await prisma.recruitmentCandidate.findUnique({
    where: { id },
    select: { cycleId: true },
  })
  if (!candidate) notFound()

  const ctx = await resolveCycleContext(candidate.cycleId)
  if (!ctx) redirect("/recruitment")

  const canViewOthers = can(ctx.role, "evaluation.viewOthers")

  const dossier = await getCandidateDossier(id, {
    viewerId: ctx.userId,
    canViewOthers,
  })
  if (!dossier) notFound()

  const c = dossier.candidate

  return (
    <div className="space-y-6">
      <RecruitmentPageHeader eyebrow={ctx.cycle.name} title={c.fullName}>
        <StageBadge stage={c.stage} />
        <ResultBadge result={c.result} />
      </RecruitmentPageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {/* ---- GD record, or an explicit explanation of its absence ---- */}
          <section className="space-y-3">
            <h2 className="section-label">
              {t("recruitment.dossier.gdRecord")}
            </h2>

            {dossier.gdStatus.kind === "bypassed" ? (
              // The case the spec calls out: show a decision, not broken data.
              <Card className="flex items-start gap-3 bg-accent p-4 text-accent-foreground">
                <FastForward className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">{t("recruitment.dossier.gdBypassedTitle")}</p>
                  <p className="text-sm">
                    {t("recruitment.dossier.gdBypassedBody", {
                      actor: dossier.gdStatus.actorName ?? ", ",
                      role: t(`recruitment.roles.${dossier.gdStatus.actorRole}` as StringKey),
                      date: dossier.gdStatus.at.toISOString().slice(0, 16).replace("T", " "),
                    })}
                  </p>
                  <p className="text-sm">
                    {dossier.gdStatus.reason ?? t("recruitment.dossier.gdBypassedNoReason")}
                  </p>
                </div>
              </Card>
            ) : dossier.gdStatus.kind === "not-required" ? (
              <Card className="flex items-start gap-3 p-4">
                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {t("recruitment.dossier.gdNotRequired")}
                </p>
              </Card>
            ) : dossier.gdStatus.kind === "pending" ? (
              <p className="text-sm text-muted-foreground">{t("recruitment.dossier.gdPending")}</p>
            ) : (
              <SessionSummary sessions={dossier.gdSessions} />
            )}

            {dossier.gdEvaluations.length > 0 && (
              <EvaluationList
                evaluations={dossier.gdEvaluations}
                aggregate={dossier.gdAggregate}
                ownOnly={!canViewOthers}
              />
            )}
          </section>

          {/* ---- PI record ---- */}
          <section className="space-y-3">
            <h2 className="section-label">
              {t("recruitment.dossier.piRecord")}
            </h2>
            {dossier.previousPiAttempts > 1 && (
              <p className="text-xs text-muted-foreground">
                {t("recruitment.dossier.previousPiAttempts", { count: dossier.previousPiAttempts })}
              </p>
            )}
            <SessionSummary sessions={dossier.piSessions} />
            <EvaluationList
              evaluations={dossier.piEvaluations}
              aggregate={dossier.piAggregate}
              ownOnly={!canViewOthers}
            />
          </section>

          {/* ---- Imported form response, verbatim ---- */}
          <section className="space-y-3">
            <h2 className="section-label">
              {t("recruitment.dossier.formResponse")}
            </h2>
            {Object.keys(dossier.formResponse).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("recruitment.dossier.noFormResponse")}
              </p>
            ) : (
              <Card className="p-4">
                <dl className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(dossier.formResponse).map(([key, value]) => (
                    <div key={key} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{key}</dt>
                      <dd className="whitespace-pre-wrap break-words text-sm">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            )}
          </section>
        </div>

        {/* ---- Sidebar: profile, provenance, history ---- */}
        <aside className="space-y-6">
          <Card className="space-y-2 p-4">
            <h2 className="section-label">
              {t("recruitment.dossier.profile")}
            </h2>
            <dl className="space-y-1.5 text-sm">
              <Row label={t("recruitment.responses.labelLabel")} value={c.email} />
              {c.phone && <Row label=", " value={c.phone} />}
              {c.branch && <Row label=", " value={c.branch} />}
              {c.year && <Row label=", " value={c.year} />}
            </dl>
            <p className="pt-2 text-xs text-muted-foreground">
              {dossier.importProvenance.sourceSheetKey
                ? t("recruitment.dossier.importedFrom", {
                    source: dossier.importProvenance.sourceSheetKey,
                  })
                : t("recruitment.dossier.noImportSource")}
            </p>
            {dossier.importProvenance.importedAt && (
              <p className="text-xs text-muted-foreground">
                {t("recruitment.dossier.importedAt", {
                  date: dossier.importProvenance.importedAt.toISOString().slice(0, 10),
                })}
              </p>
            )}
            {c.manualEditedFields.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("recruitment.candidates.manualEditNote")}
              </p>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="section-label">
              {t("recruitment.dossier.history")}
            </h2>
            {dossier.history.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("recruitment.audit.empty")}</p>
            ) : (
              <ol className="space-y-3">
                {dossier.history.map((h) => (
                  <li key={h.id} className="border-l-2 border-border pl-3 text-xs">
                    <p className="font-medium">
                      {t(`recruitment.stage.${h.fromStage}` as StringKey)} →{" "}
                      {t(`recruitment.stage.${h.toStage}` as StringKey)}
                      {h.bypass && (
                        <Badge className="ml-1.5 bg-accent font-normal text-accent-foreground">
                          {t("recruitment.candidates.bypassGd")}
                        </Badge>
                      )}
                      {h.reversedAt && (
                        <Badge className="ml-1.5 bg-muted font-normal text-muted-foreground">
                          {t("recruitment.dossier.reversedNote")}
                        </Badge>
                      )}
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      {h.actorName ?? ", "} ·{" "}
                      {t(`recruitment.roles.${h.actorRole}` as StringKey)} ·{" "}
                      <time dateTime={h.createdAt.toISOString()}>
                        {h.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                      </time>
                    </p>
                    {h.reason && <p className="mt-0.5 text-muted-foreground">{h.reason}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </aside>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  )
}

// Sessions with the exact duration the PI evaluator needs to see.
function SessionSummary({ sessions }: { sessions: DossierSession[] }) {
  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("recruitment.dossier.gdPending")}</p>
  }
  return (
    <ul className="space-y-2">
      {sessions.map((s) => (
        <li key={s.id}>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{s.groupTitle}</p>
              <p className="text-xs text-muted-foreground">
                {t(`recruitment.sessionState.${s.state}` as StringKey)}
                {s.attendance && s.attendance !== "PRESENT" && (
                  <> · {t(`recruitment.attendance.${s.attendance}` as StringKey)}</>
                )}
                {s.staff.length > 0 && <> · {s.staff.map((x) => x.name ?? x.email).join(", ")}</>}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="data-label text-muted-foreground">
                {t("recruitment.dossier.duration")}
              </p>
              <p className="font-mono tabular-nums">{formatElapsed(s.durationMs)}</p>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  )
}

// Individual evaluator scores and the aggregate, kept visibly distinct. Superseded
// versions stay listed so a revision never erases what was said first.
function EvaluationList({
  evaluations,
  aggregate,
  ownOnly,
}: {
  evaluations: DossierEvaluation[]
  aggregate: number | null
  ownOnly: boolean
}) {
  if (evaluations.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("recruitment.evaluation.noneYet")}</p>
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="data-label text-muted-foreground">
          {t("recruitment.evaluation.aggregate")}
        </p>
        <p className="font-mono text-lg tabular-nums">
          {aggregate != null ? t("recruitment.evaluation.overallOutOf", { score: aggregate }) : ", "}
        </p>
      </div>

      {ownOnly && (
        <p className="text-xs text-muted-foreground">{t("recruitment.evaluation.ownOnly")}</p>
      )}

      <ul className="divide-y divide-border/70">
        {evaluations.map((e) => (
          <li key={e.id} className="space-y-1 py-2 text-sm">
            <div className="flex flex-wrap items-baseline gap-2">
              <Badge
                className={
                  e.state === "SUBMITTED"
                    ? "bg-secondary font-normal text-secondary-foreground"
                    : "bg-muted font-normal text-muted-foreground"
                }
              >
                {t(
                  `recruitment.evaluation.${
                    e.state === "SUBMITTED"
                      ? "submitted"
                      : e.state === "SUPERSEDED"
                        ? "superseded"
                        : e.state === "VOIDED"
                          ? "voided"
                          : "draft"
                  }` as StringKey,
                )}
              </Badge>
              <span className="font-mono tabular-nums">
                {e.overall != null ? t("recruitment.evaluation.overallOutOf", { score: e.overall }) : ", "}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("recruitment.evaluation.submittedBy", {
                  name: e.evaluatorName ?? e.evaluatorEmail ?? e.evaluatorId,
                })}{" "}
                · {t(`recruitment.roles.${e.evaluatorRole}` as StringKey)}
                {e.submittedAt && (
                  <>
                    {" "}
                    ·{" "}
                    <time dateTime={e.submittedAt.toISOString()}>
                      {e.submittedAt.toISOString().slice(0, 16).replace("T", " ")}
                    </time>
                  </>
                )}
                {e.version > 1 && <> · v{e.version}</>}
              </span>
            </div>

            {Object.keys(e.scores).length > 0 && (
              <p className="text-xs text-muted-foreground">
                {Object.entries(e.scores)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}
              </p>
            )}
            {e.recommendation && (
              <p className="text-xs">
                {t(`recruitment.recommendation.${e.recommendation}` as StringKey)}
              </p>
            )}
            {e.remarks && <p className="text-sm text-muted-foreground">{e.remarks}</p>}
            {e.overrideReason && (
              <p className="text-xs text-muted-foreground">{e.overrideReason}</p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
