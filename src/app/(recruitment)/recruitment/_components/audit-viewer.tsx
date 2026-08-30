import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { t, type StringKey } from "@/content/strings"
import { RecruitmentPageHeader } from "../../_components/page-header"
import type { AuditOutcome, Prisma } from "@/generated/prisma/client"

// Filterable audit trail. Refused actions are first-class rows here (outcome
// REJECTED), which is the point: a permission or state-machine denial is evidence,
// not noise. The table is append-only at the database level, so there is
// deliberately no edit or delete affordance anywhere on this page.
//
// Every row used to be a raw event slug over two JSON blobs of cuids. The columns
// naming the candidate and the group were written on every relevant event and never
// read, so answering "what happened to this person" meant opening a database
// client. Now each row is a sentence; the blobs are still here, one disclosure
// triangle away.

const OUTCOMES: AuditOutcome[] = ["SUCCESS", "REJECTED", "FAILED"]

const OUTCOME_TONE: Record<string, string> = {
  SUCCESS: "bg-secondary text-secondary-foreground",
  REJECTED: "bg-accent text-accent-foreground",
  FAILED: "bg-[var(--signal-soft)] text-[var(--ink-soft)]",
}

const OUTCOME_LABEL: Record<AuditOutcome, StringKey> = {
  SUCCESS: "recruitment.audit.outcomeSuccess",
  REJECTED: "recruitment.audit.outcomeRejected",
  FAILED: "recruitment.audit.outcomeFailed",
}

// The event vocabulary is closed and enumerated in strings; anything unrecognised
// falls through to its raw slug rather than rendering as nothing.
function eventLabel(eventType: string): string {
  const label = t(`recruitment.audit.event.${eventType}` as StringKey)
  return label.startsWith("recruitment.audit.event.") ? eventType : label
}

type State = Record<string, unknown> | null

function asState(value: Prisma.JsonValue | null): State {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(state: State, key: string): string | null {
  const v = state?.[key]
  return typeof v === "string" ? v : null
}

function stageName(value: string | null): string | null {
  return value ? t(`recruitment.stage.${value}` as StringKey) : null
}

function resultName(value: string | null): string | null {
  return value ? t(`recruitment.result.${value}` as StringKey) : null
}

// One line saying what happened, built from the same string tables the badges use
// so the audit page and the rest of the module can never name a stage differently.
function describe(event: {
  eventType: string
  previousState: Prisma.JsonValue | null
  newState: Prisma.JsonValue | null
  meta: Prisma.JsonValue | null
  outcome: AuditOutcome
}): string | null {
  const before = asState(event.previousState)
  const after = asState(event.newState)
  const meta = asState(event.meta)

  switch (event.eventType) {
    case "candidate.result": {
      const to = resultName(str(after, "result"))
      const from = resultName(str(before, "result"))
      if (!to) return null
      const stage = stageName(str(after, "stage"))
      const moved = str(after, "stage") !== str(before, "stage")
      const stagePart = stage && moved ? ` · now ${stage}` : ""
      return from && from !== to ? `${to} · was ${from}${stagePart}` : `${to}${stagePart}`
    }
    case "candidate.transition":
    case "candidate.override": {
      const to = stageName(str(after, "stage"))
      const from = stageName(str(before, "stage"))
      if (!to) return null
      return from && from !== to ? `${from} to ${to}` : to
    }
    case "candidate.bypassGd":
      // A bypass always carries its reason, which is rendered below on its own.
      return null
    case "session.start":
    case "session.finish":
    case "session.pause":
    case "session.resume":
    case "session.abort": {
      const kind = str(meta, "kind")
      const candidates = meta?.["candidates"]
      return (
        [
          kind,
          typeof candidates === "number"
            ? t("recruitment.groups.candidateCount", { count: candidates })
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || null
      )
    }
    case "evaluation.draft":
    case "evaluation.submit":
    case "evaluation.revise": {
      const overall = after?.["overall"]
      const onFinish = meta?.["submittedOnFinish"] === true
      return (
        [
          typeof overall === "number" ? `${overall}` : null,
          onFinish ? "submitted when the session finished" : null,
        ]
          .filter(Boolean)
          .join(" · ") || null
      )
    }
    case "cycle.transition": {
      const from = str(before, "state")
      const to = str(after, "state")
      return from && to ? `${from} to ${to}` : to
    }
    case "access.denied":
    case "action.denied": {
      const action = str(meta, "action")
      const state = str(meta, "cycleState")
      return [action, state ? `cycle ${state}` : null].filter(Boolean).join(" · ") || null
    }
    default: {
      // A refusal always says which action was attempted, whatever the event.
      const attempted = str(meta, "attemptedAction")
      return event.outcome === "REJECTED" && attempted ? attempted : null
    }
  }
}

export async function AuditViewer({
  cycleId,
  cycleName,
  filters,
}: {
  cycleId: string
  cycleName: string
  filters: { event?: string; outcome?: string; actor?: string; candidate?: string }
}) {
  // The candidate filter takes a NAME. The column stores an id, so resolve first:
  // "everything that happened to this person" is the question this page exists to
  // answer, and typing a cuid was the only way to ask it.
  const candidateQuery = filters.candidate?.trim() ?? ""
  const namedCandidateIds = candidateQuery
    ? (
        await prisma.recruitmentCandidate.findMany({
          where: { cycleId, fullName: { contains: candidateQuery, mode: "insensitive" } },
          select: { id: true },
          take: 200,
        })
      ).map((c) => c.id)
    : null

  const where: Prisma.RecruitmentAuditEventWhereInput = {
    cycleId,
    ...(filters.event ? { eventType: { startsWith: filters.event } } : {}),
    ...(filters.outcome && OUTCOMES.includes(filters.outcome as AuditOutcome)
      ? { outcome: filters.outcome as AuditOutcome }
      : {}),
    ...(filters.actor ? { actorEmail: { contains: filters.actor, mode: "insensitive" } } : {}),
    ...(namedCandidateIds ? { candidateId: { in: namedCandidateIds } } : {}),
  }

  const [events, eventTypes] = await Promise.all([
    prisma.recruitmentAuditEvent.findMany({
      where,
      orderBy: { at: "desc" },
      take: 200,
    }),
    // Distinct event types actually present, so the filter never offers a dead option.
    prisma.recruitmentAuditEvent.findMany({
      where: { cycleId },
      distinct: ["eventType"],
      select: { eventType: true },
      orderBy: { eventType: "asc" },
    }),
  ])

  // Two batched lookups over the page of rows, never one per row: an N+1 here would
  // make the heaviest page in the module heavier still.
  const [candidates, groups] = await Promise.all([
    prisma.recruitmentCandidate.findMany({
      where: {
        id: {
          in: [...new Set(events.map((e) => e.candidateId).filter((id): id is string => !!id))],
        },
      },
      select: { id: true, fullName: true },
    }),
    prisma.recruitmentGroup.findMany({
      where: {
        id: { in: [...new Set(events.map((e) => e.groupId).filter((id): id is string => !!id))] },
      },
      select: { id: true, title: true, kind: true },
    }),
  ])
  const candidateById = new Map(candidates.map((c) => [c.id, c]))
  const groupById = new Map(groups.map((g) => [g.id, g]))

  return (
    <div className="space-y-6">
      <RecruitmentPageHeader
        eyebrow={cycleName}
        title={t("recruitment.audit.title")}
        description={t("recruitment.audit.description")}
      />

      <form className="flex flex-wrap items-end gap-3">
        <select
          name="event"
          defaultValue={filters.event ?? ""}
          aria-label={t("recruitment.audit.eventTypeFilter")}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">{t("recruitment.audit.allEvents")}</option>
          {eventTypes.map((e) => (
            <option key={e.eventType} value={e.eventType}>
              {eventLabel(e.eventType)}
            </option>
          ))}
        </select>
        <select
          name="outcome"
          defaultValue={filters.outcome ?? ""}
          aria-label={t("recruitment.audit.outcomeFilter")}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">{t("recruitment.audit.allOutcomes")}</option>
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {t(OUTCOME_LABEL[o])}
            </option>
          ))}
        </select>
        <input
          name="actor"
          defaultValue={filters.actor ?? ""}
          aria-label={t("recruitment.audit.actorFilter")}
          placeholder={t("recruitment.control.staffEmailLabel")}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        />
        <input
          name="candidate"
          defaultValue={candidateQuery}
          aria-label={t("recruitment.audit.candidateFilter")}
          placeholder={t("recruitment.audit.candidateFilterPlaceholder")}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        />
        <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          {t("common.search")}
        </button>
      </form>

      <p className="text-xs text-muted-foreground">{t("recruitment.audit.immutableNote")}</p>

      {namedCandidateIds?.length === 0 && (
        <p className="rounded-md bg-accent px-3 py-2 text-xs text-accent-foreground">
          {t("recruitment.audit.noCandidateMatch")}
        </p>
      )}

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("recruitment.audit.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => {
            const candidate = e.candidateId ? candidateById.get(e.candidateId) : null
            const groupRow = e.groupId ? groupById.get(e.groupId) : null
            // An interview group is titled with its candidate's name, so showing
            // both renders "Bina Bypassed · Bina Bypassed".
            const group = groupRow && groupRow.title !== candidate?.fullName ? groupRow : null
            const detail = describe(e)

            return (
              <li key={e.id}>
                <Card className="space-y-1.5 p-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Badge className={cn("font-normal", OUTCOME_TONE[e.outcome])}>
                      {t(OUTCOME_LABEL[e.outcome])}
                    </Badge>
                    <span className="font-medium">{eventLabel(e.eventType)}</span>
                    <time
                      className="ml-auto text-xs text-muted-foreground"
                      dateTime={e.at.toISOString()}
                    >
                      {e.at.toISOString().slice(0, 19).replace("T", " ")}
                    </time>
                  </div>

                  {/* Who it happened to, and where. Both link out, so a row is a
                      starting point rather than a terminus. */}
                  {(candidate || group || detail) && (
                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      {candidate && (
                        <Link
                          href={`/recruitment/candidates/${candidate.id}`}
                          prefetch
                          className="font-medium underline underline-offset-2"
                        >
                          {candidate.fullName}
                        </Link>
                      )}
                      {group && (
                        <Link
                          href={`/recruitment/${group.kind === "GD" ? "gd" : "pi"}/${group.id}`}
                          prefetch
                          className="text-muted-foreground underline underline-offset-2"
                        >
                          {group.title}
                        </Link>
                      )}
                      {detail && <span className="text-muted-foreground">{detail}</span>}
                    </p>
                  )}

                  {e.reason && <p className="text-muted-foreground">{e.reason}</p>}

                  <p className="text-xs text-muted-foreground">
                    {e.actorEmail}
                    {e.actorRole && <> · {e.actorRole}</>}
                  </p>

                  {/* The blobs and the correlation id are still here in full: this
                      is an audit trail, so nothing is dropped, only demoted. */}
                  {(e.previousState || e.newState || e.requestId) && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        {t("recruitment.audit.rawRecord")}
                      </summary>
                      <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                        {e.previousState !== null && (
                          <div>
                            <p className="text-muted-foreground">
                              {t("recruitment.audit.previousState")}
                            </p>
                            <pre className="mt-0.5 overflow-x-auto rounded bg-muted/60 p-1.5">
                              {JSON.stringify(e.previousState, null, 1)}
                            </pre>
                          </div>
                        )}
                        {e.newState !== null && (
                          <div>
                            <p className="text-muted-foreground">
                              {t("recruitment.audit.newState")}
                            </p>
                            <pre className="mt-0.5 overflow-x-auto rounded bg-muted/60 p-1.5">
                              {JSON.stringify(e.newState, null, 1)}
                            </pre>
                          </div>
                        )}
                      </div>
                      <p className="mt-1.5 font-mono text-[0.7rem] text-muted-foreground">
                        {e.eventType}
                        {e.requestId && <> · {e.requestId}</>}
                      </p>
                    </details>
                  )}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
