"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Search, UserRound } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"
import { ResultBadge, StageBadge } from "../../_components/status-badges"
import { TabStrip } from "../../_components/tab-strip"
import { createGroup } from "../group-actions"

interface QueueCandidate {
  id: string
  fullName: string
  email: string
  branch: string | null
  year: string | null
  stage: string
}

interface InProgress {
  groupId: string
  candidateName: string
  state: string
}

interface PastInterview {
  groupId: string
  candidateId: string | null
  candidateName: string
  stage: string
  result: string
  endedAt: string | null
  evaluationCount: number
}

// The PI queue.
//
// A personal interview is one candidate and one panel, so this lists PEOPLE, not
// groups. The group still exists underneath (a session hangs off one, and the
// partial unique index, the candidate lock and the session state machine all key
// off group membership) but it is created silently for a single candidate and the
// operator never sees the word.
//
// Before this, the PI page rendered a list of groups and hid the candidates inside
// a "create group" modal, which is why they looked missing after a GD.
export function PiQueue({
  cycleId,
  candidates,
  inProgress,
  past,
  canStart,
  starterMemberId,
}: {
  cycleId: string
  candidates: QueueCandidate[]
  inProgress: InProgress[]
  past: PastInterview[]
  canStart: boolean
  starterMemberId: string | null
}) {
  const router = useRouter()
  const [view, setView] = useState<"waiting" | "past">("waiting")
  const [query, setQuery] = useState("")
  const [pending, startTransition] = useTransition()
  const [starting, setStarting] = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((c) =>
      [c.fullName, c.email, c.branch, c.year].some((f) => f?.toLowerCase().includes(q)),
    )
  }, [candidates, query])

  // Past interviews search on the one field they have. Same in-memory filter, so
  // switching tabs and typing never touches the server.
  const visiblePast = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return past
    return past.filter((p) => p.candidateName.toLowerCase().includes(q))
  }, [past, query])

  function start(c: QueueCandidate) {
    setStarting(c.id)
    startTransition(async () => {
      const result = await createGroup({
        cycleId,
        kind: "PI",
        title: c.fullName,
        candidateIds: [c.id],
        // A maintainer must be assigned to evaluate. Global admins may be
        // implicit recruitment admins and therefore have no membership row.
        staff: starterMemberId ? [{ memberId: starterMemberId, canEvaluate: true }] : [],
      })
      setStarting(null)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      router.push(`/recruitment/pi/${result.groupId}`)
    })
  }

  return (
    <div className="space-y-6">
      <TabStrip
        value={view}
        onChange={setView}
        tabs={[
          { value: "waiting", label: t("recruitment.pi.waitingTab"), count: candidates.length },
          { value: "past", label: t("recruitment.pi.pastTab"), count: past.length },
        ]}
      />

      {/* One search box above both tabs: the thing you are looking for is a
          person, and which tab they are on is exactly what you do not know. */}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("recruitment.pi.searchPlaceholder")}
          aria-label={t("common.search")}
          className="pl-8"
        />
      </div>

      {view === "past" ? (
        <section className="space-y-3">
          {visiblePast.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {past.length === 0 ? t("recruitment.pi.pastEmpty") : t("recruitment.pi.noMatches")}
            </p>
          ) : (
            <ul className="divide-y divide-border/70 rounded-md border border-border/70">
              {visiblePast.map((p) => (
                <li key={p.groupId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{p.candidateName}</p>
                      <StageBadge stage={p.stage} />
                      <ResultBadge result={p.result} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.endedAt && (
                        <>
                          {t("recruitment.groups.finishedAt")}{" "}
                          <time dateTime={p.endedAt}>{p.endedAt.slice(0, 16).replace("T", " ")}</time>
                          {" · "}
                        </>
                      )}
                      {t("recruitment.groups.evaluationCount", { count: p.evaluationCount })}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {p.candidateId && (
                      <Link
                        href={`/recruitment/candidates/${p.candidateId}`}
                        prefetch
                        className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                      >
                        {t("recruitment.candidates.openDossier")}
                      </Link>
                    )}
                    {/* The whole point of this tab: a finished interview stays
                        reachable, so a score can still be revised. */}
                    <Link
                      href={`/recruitment/pi/${p.groupId}`}
                      prefetch
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      {t("recruitment.overview.openConsole")}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
      {inProgress.length > 0 && (
        <section className="space-y-2">
          <h2 className="section-label">{t("recruitment.pi.inProgress")}</h2>
          <ul className="divide-y divide-border/70 rounded-md border border-border/70">
            {inProgress.map((i) => (
              <li key={i.groupId} className="flex items-center gap-3 px-4 py-3">
                <UserRound className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {i.candidateName}
                </span>
                <Link
                  href={`/recruitment/pi/${i.groupId}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  {t("recruitment.pi.resume")}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t("recruitment.pi.waiting", { count: visible.length })}
        </p>

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {candidates.length === 0 ? t("recruitment.pi.empty") : t("recruitment.pi.noMatches")}
          </p>
        ) : (
          <ul className="divide-y divide-border/70 rounded-md border border-border/70">
            {visible.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{c.fullName}</p>
                    <StageBadge stage={c.stage} />
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[c.email, c.branch, c.year].filter(Boolean).join(" · ")}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/recruitment/candidates/${c.id}`}
                    prefetch
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                  >
                    {t("recruitment.candidates.openDossier")}
                  </Link>
                  {canStart && (
                    <Button size="sm" disabled={pending} onClick={() => start(c)}>
                      {starting === c.id
                        ? t("recruitment.pi.starting")
                        : t("recruitment.pi.startInterview")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
        </>
      )}
    </div>
  )
}
