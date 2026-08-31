"use client"

import { formatDateTime } from "@/lib/datetime"
import { useState } from "react"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"
import { SessionTimer } from "../../_components/session-timer"
import { SessionStateBadge } from "../../_components/status-badges"
import { TabStrip } from "../../_components/tab-strip"
import type { GroupListItem } from "../_lib/queries"
import type { SessionDisplayState } from "@/lib/recruitment/session"

// Shared by /recruitment/gd and /recruitment/pi: the two rounds differ only in
// their copy and their route, so they share one list rather than two near-copies.
//
// Finished panels used to sit in this same grid forever -- the query excluded only
// ARCHIVED -- so by the end of a recruitment drive the live panels were buried in
// completed ones, and there was no way to say "show me what we ran yesterday".
// Both sets ship together and the toggle is client-side, so Past costs no request.
export function GroupList({
  live,
  past,
  kind,
  scoped,
}: {
  live: GroupListItem[]
  past: GroupListItem[]
  kind: "GD" | "PI"
  // True when the viewer only sees their own assignments (a JC), which changes the
  // empty state from "nothing exists" to "nothing assigned to you".
  scoped: boolean
}) {
  const [view, setView] = useState<"live" | "past">("live")
  const groups = view === "live" ? live : past
  const base = kind === "GD" ? "/recruitment/gd" : "/recruitment/pi"

  return (
    <div className="space-y-4">
      <TabStrip
        value={view}
        onChange={setView}
        tabs={[
          { value: "live", label: t("recruitment.groups.liveTab"), count: live.length },
          { value: "past", label: t("recruitment.groups.pastTab"), count: past.length },
        ]}
      />

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {view === "past"
            ? scoped
              ? t("recruitment.groups.emptyPastScoped")
              : t("recruitment.groups.emptyPast")
            : scoped
              ? t("recruitment.groups.emptyScoped")
              : t("recruitment.groups.emptyLive")}
        </p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Card className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{g.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("recruitment.groups.candidateCount", { count: g.candidateCount })} ·{" "}
                      {t("recruitment.groups.evaluationCount", { count: g.evaluationCount })}
                    </p>
                  </div>
                  <SessionStateBadge state={g.displayState as SessionDisplayState} />
                </div>

                {g.staff.length > 0 && (
                  <p className="truncate text-xs text-muted-foreground">
                    {t("recruitment.groups.staffLabel")}:{" "}
                    {g.staff.map((s) => s.name ?? s.email).join(", ")}
                  </p>
                )}

                <div className="mt-auto flex items-end justify-between gap-3">
                  <div>
                    <p className="data-label text-muted-foreground">
                      {g.endedAt
                        ? t("recruitment.groups.finishedAt")
                        : g.session?.startedAt
                          ? t("recruitment.session.elapsed")
                          : t("recruitment.groups.scheduled")}
                    </p>
                    {/* A finished panel wants a date, not a running clock. */}
                    {g.endedAt ? (
                      <time className="text-sm" dateTime={g.endedAt}>
                        {formatDateTime(g.endedAt)}
                      </time>
                    ) : g.session?.startedAt ? (
                      <SessionTimer session={g.session} className="text-xl" />
                    ) : (
                      <p className="text-sm">
                        {g.scheduledAt
                          ? formatDateTime(g.scheduledAt)
                          : t("recruitment.groups.unscheduled")}
                      </p>
                    )}
                  </div>
                  <Link
                    href={`${base}/${g.id}`}
                    prefetch
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    {t("recruitment.overview.openConsole")}
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
