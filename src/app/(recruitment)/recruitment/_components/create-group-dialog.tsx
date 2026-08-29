"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { t, type StringKey } from "@/content/strings"
import { createGroup } from "../group-actions"

interface CandidateOption {
  id: string
  fullName: string
  email: string
  branch: string | null
  year: string | null
}

interface StaffOption {
  memberId: string
  role: string
  name: string | null
  email: string
}

export function CreateGroupDialog({
  cycleId,
  kind,
  candidates,
  staff,
}: {
  cycleId: string
  kind: "GD" | "PI"
  candidates: CandidateOption[]
  staff: StaffOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [scheduledAt, setScheduledAt] = useState("")
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // JCs need an explicit "may score" grant; maintainers always can.
  const [staffPicked, setStaffPicked] = useState<Map<string, boolean>>(new Map())
  const [pending, startTransition] = useTransition()

  // Filtering happens here, not on the server: the full assignable list is already
  // in this component, and a cycle is a few hundred people. Picking ten of them out
  // of 267 checkboxes with no search was the actual blocker.
  const [candidateQuery, setCandidateQuery] = useState("")
  const visibleCandidates = useMemo(() => {
    const query = candidateQuery.trim().toLowerCase()
    if (!query) return candidates
    return candidates.filter((c) =>
      [c.fullName, c.email, c.branch, c.year].some((field) =>
        field?.toLowerCase().includes(query),
      ),
    )
  }, [candidates, candidateQuery])

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleStaff = (memberId: string) =>
    setStaffPicked((prev) => {
      const next = new Map(prev)
      if (next.has(memberId)) next.delete(memberId)
      else next.set(memberId, false)
      return next
    })

  function submit() {
    startTransition(async () => {
      const result = await createGroup({
        cycleId,
        kind,
        title,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        candidateIds: [...picked],
        staff: [...staffPicked].map(([memberId, canEvaluate]) => ({ memberId, canEvaluate })),
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(t("recruitment.groups.create"))
      setOpen(false)
      setTitle("")
      setScheduledAt("")
      setPicked(new Set())
      setStaffPicked(new Map())
      router.refresh()
    })
  }

  return (
    <>
      {/* Controlled dialog with an external trigger: the pattern already used by
          the admin committee and moderation dialogs. */}
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" />
        {t(kind === "GD" ? "recruitment.groups.newGroup" : "recruitment.groups.newPanel")}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t(kind === "GD" ? "recruitment.groups.newGroup" : "recruitment.groups.newPanel")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="group-title">{t("recruitment.groups.createTitleLabel")}</Label>
                <Input
                  id="group-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("recruitment.groups.titlePlaceholder")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="group-when">{t("recruitment.groups.createScheduleLabel")}</Label>
                <Input
                  id="group-when"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("recruitment.groups.createStaffLabel")}</Label>
              <ul className="divide-y divide-border/70 rounded-md border border-border/70">
                {staff.map((s) => {
                  const selected = staffPicked.has(s.memberId)
                  return (
                    <li key={s.memberId} className="flex items-center gap-3 px-3 py-2">
                      <Checkbox
                        id={`staff-${s.memberId}`}
                        checked={selected}
                        onCheckedChange={() => toggleStaff(s.memberId)}
                      />
                      <Label htmlFor={`staff-${s.memberId}`} className="min-w-0 flex-1 font-normal">
                        <span className="truncate">{s.name ?? s.email}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t(`recruitment.roles.${s.role}` as StringKey)}
                        </span>
                      </Label>
                      {/* Only a JC needs the extra grant: a Senior Council member
                          always scores the groups they staff. */}
                      {selected && s.role === "JC" && (
                        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <Checkbox
                            checked={staffPicked.get(s.memberId) ?? false}
                            onCheckedChange={(v) =>
                              setStaffPicked((prev) => new Map(prev).set(s.memberId, v === true))
                            }
                          />
                          {t("recruitment.groups.canEvaluateLabel")}
                        </label>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="space-y-2">
              <Label>
                {t("recruitment.groups.createCandidatesLabel")} ·{" "}
                {t("recruitment.groups.candidateCount", { count: picked.size })}
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={candidateQuery}
                  onChange={(e) => setCandidateQuery(e.target.value)}
                  placeholder={t("recruitment.groups.searchCandidates")}
                  className="pl-8"
                />
              </div>
              <ul className="max-h-64 divide-y divide-border/70 overflow-y-auto rounded-md border border-border/70">
                {visibleCandidates.length === 0 && (
                  <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {t("recruitment.groups.noMatchingCandidates")}
                  </li>
                )}
                {visibleCandidates.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                    <Checkbox
                      id={`cand-${c.id}`}
                      checked={picked.has(c.id)}
                      onCheckedChange={() => toggle(c.id)}
                    />
                    <Label htmlFor={`cand-${c.id}`} className="min-w-0 flex-1 font-normal">
                      <span className="truncate">{c.fullName}</span>
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {[c.branch, c.year].filter(Boolean).join(" · ")}
                      </span>
                    </Label>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || title.trim().length < 2}>
              {pending ? t("recruitment.groups.creating") : t("recruitment.groups.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
