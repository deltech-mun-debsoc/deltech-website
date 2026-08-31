import { prisma } from "@/lib/prisma"
import {
  mayPerform,
  requireRecruitmentAccess,
  resolveCycleContext,
} from "@/lib/recruitment/authz"
import { t } from "@/content/strings"
import { RecruitmentPageHeader } from "../../_components/page-header"
import { LiveRefresh } from "@/components/recruitment/live-refresh"
import { CandidatesList } from "../_components/candidates-list"
import { SelectionActions } from "../_components/selection-actions"
import { selectionEmailStatus } from "../selection-email-actions"
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

// Candidates whose stored form response mentions `q` anywhere.
//
// The promoted columns are filtered in the browser, but the full form response is
// 2.5-4 KB per candidate (24 sheet columns keyed by whole question sentences), so
// shipping it to every client to search occasionally is not worth ~1 MB a page.
// This stays on the server behind an explicit opt-in.
//
// Prisma's `string_contains` matches a string VALUE at a path, not anywhere in a
// document: verified against 254 real candidates, it returned 0 for a term present
// in 19 of them. Hence the raw text match.
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
  searchParams: Promise<{ answers?: string }>
}) {
  const { cycle } = await requireRecruitmentAccess()
  if (!cycle) return null

  const ctx = await resolveCycleContext(cycle.id)
  if (!ctx) return null

  // Opt-in: "search the answers too" is the one filter that cannot run client-side.
  const answersQuery = (await searchParams).answers?.trim() ?? ""
  const answerMatchIds = await formAnswerMatches(cycle.id, answersQuery)

  // Everyone who holds candidate.view sees the whole cycle's candidates, JC
  // included. This list used to be filtered to the groups a JC staffs, which read
  // as "recruitment is broken for JCs": they now reach a live cycle from their app
  // role alone, usually before anyone has seated them on a panel, so the list was
  // simply empty while maintainers saw everything.
  //
  // It was never a real confidentiality boundary either. candidates/[id] resolves a
  // dossier by id and does not scope by group, so any JC could already open any
  // candidate by URL; the filter hid rows from a list rather than protecting them.
  // What actually withholds candidate data from a JC is unchanged and elsewhere:
  // interview.conduct keeps them out of the PI queue and interview scores, and
  // requireGroupAccess still scopes every session console to their own panels.
  const where: Prisma.RecruitmentCandidateWhereInput = {
    cycleId: cycle.id,
    ...(answersQuery ? { id: { in: answerMatchIds } } : {}),
  }

  // The whole cycle in one query, filtered in the browser from here on. Searching
  // used to be a GET navigation plus three queries per keystroke-and-enter, and the
  // list silently truncated at a page boundary while showing the true total.
  //
  // ponytail: ~250 bytes per row, so a few hundred candidates is ~60 KB. Paginate
  // on the server again if a cycle ever runs to thousands.
  // Returns null for anyone who may not send, which is what hides the control.
  const emailStatus = await selectionEmailStatus(cycle.id)

  const candidates = await prisma.recruitmentCandidate.findMany({
    where,
    orderBy: [{ fullName: "asc" }],
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      year: true,
      branch: true,
      stage: true,
      result: true,
      gdRequired: true,
      piRequired: true,
      version: true,
      // Has this candidate actually sat a PI that finished? Kept because it is
      // the strongest signal, but it is NO LONGER the only way to reach a
      // decision -- see decidable() below.
      groupMemberships: {
        where: {
          kind: "PI",
          attendance: { not: "REASSIGNED" },
          group: { sessions: { some: { kind: "PI", state: "COMPLETED" } } },
        },
        take: 1,
        select: { id: true },
      },
    },
  })

  return (
    <div className="space-y-6">
      <LiveRefresh cycleId={cycle.id} />

      <RecruitmentPageHeader
        eyebrow={cycle.name}
        title={t("recruitment.candidates.title")}
        description={t("recruitment.candidates.description")}
      >
        <SelectionActions
          cycleId={cycle.id}
          // This used to be `scopedGroups === null`, guarding against a JC
          // exporting their own partial slice as if it were the whole cycle.
          // Nobody's list is partial any more, so the export matches what is on
          // screen for everyone who can reach this page.
          canExport
          email={emailStatus}
        />
      </RecruitmentPageHeader>

      <CandidatesList
        candidates={candidates.map(({ groupMemberships, ...candidate }) => ({
          ...candidate,
          hasCompletedPi: groupMemberships.length > 0,
        }))}
        cycleId={cycle.id}
        stages={STAGES}
        results={RESULTS}
        answersQuery={answersQuery}
        canBypass={mayPerform(ctx, "candidate.bypassGd")}
        canAdvance={mayPerform(ctx, "candidate.advance")}
        canHold={mayPerform(ctx, "candidate.hold")}
        canFinalise={mayPerform(ctx, "candidate.finalise")}
      />
    </div>
  )
}
