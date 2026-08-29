"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Mail } from "lucide-react"
import { t } from "@/content/strings"
import { recruitCandidate } from "../actions"

// The second half of finalisation: turning a SELECTED candidate into a society
// member. Kept visibly separate from the selection decision itself, because they are
// separate actions with separate consequences.
//
// Safe to retry: the server returns the existing membership if one already exists,
// so a double-click reports "already added" rather than creating a second user.
export function FinalisationPanel({
  selected,
  awaiting,
  recruited,
  recruitmentComplete,
  disabled,
}: {
  selected: {
    id: string
    fullName: string
    email: string
    addedToSociety: boolean
    decidedAt: string | null
  }[]
  awaiting: { id: string; fullName: string; email: string; stage: string }[]
  recruited: {
    id: string
    fullName: string
    email: string
    societyRole: string | null
    recruitedAt: string | null
  }[]
  recruitmentComplete: boolean
  disabled: boolean
}) {
  const router = useRouter()
  const [designation, setDesignation] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function recruit(candidateId: string) {
    setBusy(candidateId)
    startTransition(async () => {
      const result = await recruitCandidate({
        candidateId,
        societyRole: "MEMBER",
        designation: designation[candidateId]?.trim() || undefined,
      })
      setBusy(null)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.idempotent
          ? t("recruitment.control.alreadyRecruited")
          : t("recruitment.control.recruited"),
      )
      router.refresh()
    })
  }

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="section-label">
          {t("recruitment.control.finaliseTitle")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("recruitment.control.finaliseDescription")}
        </p>
      </div>

      <section className="space-y-3 rounded-md border border-border/70 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">
              {t("recruitment.control.finalSelectedTitle")} · {selected.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("recruitment.control.finalSelectedDescription")}
            </p>
          </div>
          <Button size="sm" className="gap-1.5" disabled>
            <Mail className="size-3.5" />
            {t("recruitment.control.emailSelected")}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {t(
            recruitmentComplete
              ? "recruitment.control.emailTemplatePending"
              : "recruitment.control.completeBeforeEmail",
          )}
        </p>

        {selected.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("recruitment.control.noFinalSelected")}
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {selected.map((candidate) => (
              <li
                key={candidate.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{candidate.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">{candidate.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline">
                    {t(
                      candidate.addedToSociety
                        ? "recruitment.control.addedToSociety"
                        : "recruitment.control.awaitingSociety",
                    )}
                  </Badge>
                  {candidate.decidedAt && (
                    <time className="text-xs text-muted-foreground" dateTime={candidate.decidedAt}>
                      {candidate.decidedAt.slice(0, 10)}
                    </time>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-sm font-medium">
          {t("recruitment.control.awaitingRecruitment")} · {awaiting.length}
        </p>
        {awaiting.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("recruitment.overview.allDone")}</p>
        ) : (
          <ul className="space-y-2">
            {awaiting.map((c) => (
              <li
                key={c.id}
                className="grid gap-2 rounded-md border border-border/70 p-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                </div>

                <Input
                  className="h-9"
                  value={designation[c.id] ?? ""}
                  disabled={disabled || pending}
                  onChange={(e) =>
                    setDesignation((prev) => ({ ...prev, [c.id]: e.target.value }))
                  }
                  placeholder={t("recruitment.control.recruitDesignationPlaceholder")}
                />

                <Button
                  size="sm"
                  disabled={disabled || pending}
                  onClick={() => recruit(c.id)}
                >
                  {busy === c.id
                    ? t("recruitment.control.recruiting")
                    : t("recruitment.control.recruit")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {recruited.length > 0 && (
        <section className="space-y-2 border-t border-border/70 pt-3">
          <p className="text-sm font-medium">{t("recruitment.control.recruited")}</p>
          <ul className="divide-y divide-border/70">
            {recruited.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{r.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.societyRole && (
                    <Badge className="bg-secondary font-normal text-secondary-foreground">
                      {r.societyRole}
                    </Badge>
                  )}
                  {r.recruitedAt && (
                    <time className="text-xs text-muted-foreground" dateTime={r.recruitedAt}>
                      {r.recruitedAt.slice(0, 10)}
                    </time>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Card>
  )
}
