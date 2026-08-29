import Link from "next/link"
import { Card } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"
import { SessionTimer } from "../../_components/session-timer"
import { SessionStateBadge } from "../../_components/status-badges"
import type { GroupListItem } from "../_lib/queries"
import type { SessionDisplayState } from "@/lib/recruitment/session"

// Shared by /recruitment/gd and /recruitment/pi: the two rounds differ only in
// their copy and their route, so they share one list rather than two near-copies.
export function GroupList({
  groups,
  kind,
  scoped,
}: {
  groups: GroupListItem[]
  kind: "GD" | "PI"
  // True when the viewer only sees their own assignments (a JC), which changes the
  // empty state from "nothing exists" to "nothing assigned to you".
  scoped: boolean
}) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {scoped ? t("recruitment.groups.emptyScoped") : t("recruitment.groups.empty")}
      </p>
    )
  }

  const base = kind === "GD" ? "/recruitment/gd" : "/recruitment/pi"

  return (
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
                  {g.session?.startedAt
                    ? t("recruitment.session.elapsed")
                    : t("recruitment.groups.scheduled")}
                </p>
                {g.session?.startedAt ? (
                  <SessionTimer session={g.session} className="text-xl" />
                ) : (
                  <p className="text-sm">
                    {g.scheduledAt
                      ? g.scheduledAt.toISOString().slice(0, 16).replace("T", " ")
                      : t("recruitment.groups.unscheduled")}
                  </p>
                )}
              </div>
              <Link
                href={`${base}/${g.id}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                {t("recruitment.overview.openConsole")}
              </Link>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  )
}
