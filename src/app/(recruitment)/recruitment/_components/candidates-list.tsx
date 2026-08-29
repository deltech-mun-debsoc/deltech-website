"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { t, type StringKey } from "@/content/strings"
import { ResultBadge, StageBadge } from "../../_components/status-badges"
import { BypassGdButton } from "./bypass-gd-button"
import { AdvanceCandidateButton } from "./advance-candidate-button"
import {
  nextNaturalStage,
  type CandidateResultName,
  type CandidateStageName,
} from "@/lib/recruitment/transitions"

export interface CandidateRow {
  id: string
  fullName: string
  email: string
  phone: string | null
  year: string | null
  branch: string | null
  stage: string
  result: string
  gdRequired: boolean
  piRequired: boolean
}

// Where the "advance" button would send this candidate, or null when there is no
// sensible next queue. Only the resting stages get one: a candidate mid-session is
// moved by the session, and DECISION/CLOSED are deliberate calls made on the
// dossier rather than from a list row.
const ADVANCE_LABELS: Partial<Record<CandidateStageName, StringKey>> = {
  GD_PENDING: "recruitment.candidates.advanceToGd",
  PI_PENDING: "recruitment.candidates.advanceToPi",
}

function advanceTargetFor(c: CandidateRow): { to: CandidateStageName; label: string } | null {
  if (c.result !== "PENDING") return null
  const resting: CandidateStageName[] = ["INTAKE", "GD_COMPLETE", "GD_BYPASSED", "PI_COMPLETE"]
  if (!resting.includes(c.stage as CandidateStageName)) return null

  const to = nextNaturalStage({
    stage: c.stage as CandidateStageName,
    result: c.result as CandidateResultName,
    gdRequired: c.gdRequired,
    piRequired: c.piRequired,
  })
  if (!to) return null
  const key = ADVANCE_LABELS[to]
  return key ? { to, label: t(key) } : null
}

// The candidate list, filtered in the browser.
//
// This used to be a GET form: every search was a full document navigation plus
// three queries, and the list silently truncated at a page boundary. A cycle is a
// few hundred people and one row is ~250 bytes, so the whole cycle ships once and
// every keystroke is instant.
//
// ponytail: linear scan over the full array per keystroke. Fine into the low
// thousands; index the list or go back to the server if a cycle ever outgrows that.
export function CandidatesList({
  candidates,
  cycleId,
  stages,
  results,
  answersQuery,
  canBypass,
  canAdvance,
}: {
  candidates: CandidateRow[]
  cycleId: string
  stages: string[]
  results: string[]
  answersQuery: string
  canBypass: boolean
  canAdvance: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [stage, setStage] = useState("")
  const [result, setResult] = useState("")

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return candidates.filter((c) => {
      if (stage && c.stage !== stage) return false
      if (result && c.result !== result) return false
      if (!q) return true
      return [c.fullName, c.email, c.branch, c.year, c.phone].some((field) =>
        field?.toLowerCase().includes(q),
      )
    })
  }, [candidates, query, stage, result])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("recruitment.candidates.searchPlaceholder")}
            aria-label={t("common.search")}
            className="pl-8"
          />
        </div>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          aria-label={t("recruitment.candidates.stageFilter")}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">{t("recruitment.candidates.allStages")}</option>
          {stages.map((s) => (
            <option key={s} value={s}>
              {t(`recruitment.stage.${s}` as StringKey)}
            </option>
          ))}
        </select>
        <select
          value={result}
          onChange={(e) => setResult(e.target.value)}
          aria-label={t("recruitment.candidates.resultFilter")}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">{t("recruitment.candidates.allResults")}</option>
          {results.map((r) => (
            <option key={r} value={r}>
              {t(`recruitment.result.${r}` as StringKey)}
            </option>
          ))}
        </select>
        {/* The one filter that has to go to the server: form answers are far too
            large to ship to every client for an occasional search. */}
        <button
          type="button"
          onClick={() =>
            router.push(
              query.trim()
                ? `/recruitment/candidates?answers=${encodeURIComponent(query.trim())}`
                : "/recruitment/candidates",
            )
          }
          className={cn(buttonVariants({ variant: answersQuery ? "default" : "outline", size: "sm" }))}
        >
          {t("recruitment.candidates.searchAnswers")}
        </button>
      </div>

      {answersQuery && (
        <p className="rounded-md bg-accent px-3 py-2 text-xs text-accent-foreground">
          {t("recruitment.candidates.answersFiltered", { query: answersQuery })}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        {t("recruitment.candidates.count", { count: visible.length })}
      </p>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {candidates.length === 0
            ? t("recruitment.candidates.emptyCycle")
            : t("recruitment.candidates.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-md border border-border/70">
          {visible.map((c) => {
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
                  {canBypass && c.gdRequired && (c.stage === "INTAKE" || c.stage === "GD_PENDING") && (
                    <BypassGdButton candidateId={c.id} candidateName={c.fullName} cycleId={cycleId} />
                  )}
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
