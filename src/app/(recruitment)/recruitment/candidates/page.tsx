import Link from "next/link"
import { prisma } from "@/lib/prisma"
import {
  mayPerform,
  requireRecruitmentAccess,
  resolveCycleContext,
  visibleGroupIds,
} from "@/lib/recruitment/authz"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"
import { RecruitmentPageHeader } from "../../_components/page-header"
import { LiveRefresh } from "@/components/recruitment/live-refresh"
import { ResultBadge, StageBadge } from "../../_components/status-badges"
import { BypassGdButton } from "../_components/bypass-gd-button"
import { AdvanceCandidateButton } from "../_components/advance-candidate-button"
import { nextNaturalStage, type CandidateStageName, type CandidateResultName } from "@/lib/recruitment/transitions"
import type { CandidateResult, CandidateStage, Prisma } from "@/generated/prisma/client"

const STAGES: CandidateStage[] = [
  "INTAKE",
  "GD_PENDING",
  "GD_ACTIVE",
  "GD_COMPLETE",
  "GD_BYPASSED",
  "PI_PENDING",
  "PI_ACTIVE",
  "PI_COMPLETE",
  "DECISION",
  "CLOSED",
]
const RESULTS: CandidateResult[] = [
  "PENDING",
  "ON_HOLD",
  "SELECTED",
  "REJECTED",
  "WITHDRAWN",
  "DISQUALIFIED",
]


// Where the "advance" button would send this candidate, or null when there is no
// sensible next queue. Only the resting stages get a button: a candidate mid
// session is moved by the session, and DECISION/CLOSED are deliberate human calls
// made on the dossier rather than from a list row.
const ADVANCE_LABELS: Partial<Record<CandidateStageName, string>> = {
  GD_PENDING: "recruitment.candidates.advanceToGd",
  PI_PENDING: "recruitment.candidates.advanceToPi",
}

function advanceTargetFor(c: {
  stage: CandidateStage
  result: CandidateResult
  gdRequired: boolean
  piRequired: boolean
}): { to: CandidateStageName; label: string } | null {
  // A decided candidate stays decided; reopening them is a dossier action.
  if (c.result !== "PENDING") return null
  const restingStages: CandidateStageName[] = ["INTAKE", "GD_COMPLETE", "GD_BYPASSED", "PI_COMPLETE"]
  if (!restingStages.includes(c.stage as CandidateStageName)) return null

  const to = nextNaturalStage({
    stage: c.stage as CandidateStageName,
    result: c.result as CandidateResultName,
    gdRequired: c.gdRequired,
    piRequired: c.piRequired,
  })
  if (!to) return null
  const key = ADVANCE_LABELS[to]
  if (!key) return null
  return { to, label: t(key as Parameters<typeof t>[0]) }
}


// Candidates whose stored form response mentions `q` anywhere.
//
// The response is a JSONB document of every sheet column, and Prisma cannot search
// across a whole document: `string_contains` targets a value at a known path, which
// silently matched nothing. Casting to text and using ILIKE does what an operator
// means by "search the answers", and the GIN/trigram indexes added alongside this
// keep it off a sequential scan.
//
// ponytail: two round trips (ids, then rows). Fine at a few hundred candidates per
// cycle; fold into one raw query if a cycle ever gets large enough to notice.
async function formAnswerMatches(cycleId: string, q: string): Promise<string[]> {
  if (!q) return []
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "RecruitmentCandidate"
    WHERE "cycleId" = ${cycleId}
      AND "formAnswers"::text ILIKE ${"%" + q + "%"}
    LIMIT 500
  `
  return rows.map((r) => r.id)
}

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string; result?: string; page?: string }>
}) {
  const { cycle } = await requireRecruitmentAccess()
  if (!cycle) return null

  const ctx = await resolveCycleContext(cycle.id)
  if (!ctx) return null

  const sp = await searchParams
  // The list used to `take: 200` while displaying the true count, so past 200
  // candidates it silently hid the rest with no indication.
  const PAGE_SIZE = 100
  const page = Math.max(1, Number(sp.page) || 1)
  const q = sp.q?.trim() ?? ""

  // A JC only sees candidates in groups they staff: a capability check alone would
  // still hand them the whole cycle's candidate list.
  const scopedGroups = await visibleGroupIds(ctx)

  const answerMatchIds = await formAnswerMatches(cycle.id, q)

  const where: Prisma.RecruitmentCandidateWhereInput = {
    cycleId: cycle.id,
    ...(scopedGroups
      ? { groupMemberships: { some: { groupId: { in: scopedGroups } } } }
      : {}),
    ...(sp.stage && STAGES.includes(sp.stage as CandidateStage)
      ? { stage: sp.stage as CandidateStage }
      : {}),
    ...(sp.result && RESULTS.includes(sp.result as CandidateResult)
      ? { result: sp.result as CandidateResult }
      : {}),
    ...(q
      ? {
          OR: [
            { fullName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { branch: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
            { year: { contains: q, mode: "insensitive" } },
            // Answers that are not promoted to columns (prior experience,
            // department preference, portfolio links) live in formAnswers. Prisma's
            // `string_contains` matches a string VALUE at a path, not anywhere in
            // the document, so it silently returned nothing for these; the ids come
            // from a raw text search instead. See formAnswerMatches below.
            ...(answerMatchIds.length > 0 ? [{ id: { in: answerMatchIds } }] : []),
          ],
        }
      : {}),
  }

  const [candidates, total] = await Promise.all([
    prisma.recruitmentCandidate.findMany({
      where,
      orderBy: [{ fullName: "asc" }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: {
        id: true,
        fullName: true,
        email: true,
        year: true,
        branch: true,
        stage: true,
        result: true,
        gdRequired: true,
      piRequired: true,
        manualEditedFields: true,
      },
    }),
    prisma.recruitmentCandidate.count({ where }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const canBypass = mayPerform(ctx, "candidate.bypassGd")
  const canAdvance = mayPerform(ctx, "candidate.advance")

  return (
    <div className="space-y-6">
      <LiveRefresh cycleId={cycle.id} pollMs={30000} />

      <RecruitmentPageHeader
        eyebrow={cycle.name}
        title={t("recruitment.candidates.title")}
        description={t("recruitment.candidates.description")}
      />

      {/* GET form so filters are shareable and survive a refresh. */}
      <form className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="sr-only">
            {t("common.search")}
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder={t("recruitment.candidates.searchPlaceholder")}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          />
        </div>
        <select
          name="stage"
          defaultValue={sp.stage ?? ""}
          aria-label={t("recruitment.candidates.stageFilter")}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">{t("recruitment.candidates.allStages")}</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {t(`recruitment.stage.${s}`)}
            </option>
          ))}
        </select>
        <select
          name="result"
          defaultValue={sp.result ?? ""}
          aria-label={t("recruitment.candidates.resultFilter")}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">{t("recruitment.candidates.allResults")}</option>
          {RESULTS.map((r) => (
            <option key={r} value={r}>
              {t(`recruitment.result.${r}`)}
            </option>
          ))}
        </select>
        <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          {t("common.search")}
        </button>
      </form>

      <p className="text-xs text-muted-foreground">
        {t("recruitment.candidates.count", { count: total })}
      </p>

      {totalPages > 1 && (
        <nav className="flex items-center justify-between gap-3 text-sm" aria-label={t("recruitment.candidates.pagination")}>
          <span className="text-muted-foreground">
            {t("recruitment.candidates.pageOf", { page, pages: totalPages })}
          </span>
          <span className="flex gap-2">
            {page > 1 && (
              <Link
                href={`?${new URLSearchParams({ ...sp, page: String(page - 1) }).toString()}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                {t("common.back")}
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`?${new URLSearchParams({ ...sp, page: String(page + 1) }).toString()}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                {t("common.next")}
              </Link>
            )}
          </span>
        </nav>
      )}

      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {total === 0 && !q && !sp.stage && !sp.result
            ? t("recruitment.candidates.emptyCycle")
            : t("recruitment.candidates.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-md border border-border/70">
          {candidates.map((c) => {
            const advance = advanceTargetFor(c)
            return (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{c.fullName}</p>
                  <StageBadge stage={c.stage} />
                  <ResultBadge result={c.result} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {[c.email, c.branch, c.year].filter(Boolean).join(" · ")}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {/* Only offered where it is actually legal: still pre-GD, and the
                    viewer holds the capability. JCs never see this. */}
                {canBypass && c.gdRequired && (c.stage === "INTAKE" || c.stage === "GD_PENDING") && (
                  <BypassGdButton candidateId={c.id} candidateName={c.fullName} cycleId={cycle.id} />
                )}
                {/* The recovery path out of a resting stage. Sessions advance the
                    candidates who attended, so this covers absentees, aborted
                    groups and bypassed candidates who never sat in one. The
                    destination comes from the same pure function the server uses. */}
                {canAdvance && advance && (
                  <AdvanceCandidateButton candidateId={c.id} to={advance.to} label={advance.label} />
                )}
                <Link
                  href={`/recruitment/candidates/${c.id}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  {t("recruitment.candidates.openDossier")}
                </Link>
              </div>
            </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
