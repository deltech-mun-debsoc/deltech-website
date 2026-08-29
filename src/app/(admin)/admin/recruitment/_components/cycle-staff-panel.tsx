"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { t, type StringKey } from "@/content/strings"
import type { RecruitmentRole } from "@/generated/prisma/client"
import { assignRecruitmentMember, revokeRecruitmentMember } from "../actions"

const ROLES: RecruitmentRole[] = ["JC", "MAINTAINER", "ADMIN"]

// Per-cycle council assignment. This is the ONLY thing that grants recruitment
// authority, and it grants nothing in this dashboard, which is the note shown to
// the operator so the separation is obvious rather than implied.
export function CycleStaffPanel({
  cycleId,
  members,
  disabled,
}: {
  cycleId: string
  members: {
    id: string
    role: string
    isActive: boolean
    name: string | null
    email: string
    appRole: string
  }[]
  disabled: boolean
}) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<RecruitmentRole>("JC")
  const [pending, startTransition] = useTransition()

  function assign() {
    startTransition(async () => {
      const result = await assignRecruitmentMember({ cycleId, email, role })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(t("recruitment.control.staffAdd"))
      setEmail("")
      router.refresh()
    })
  }

  function revoke(memberId: string) {
    startTransition(async () => {
      const result = await revokeRecruitmentMember({ cycleId, memberId })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(t("recruitment.control.staffRevoke"))
      router.refresh()
    })
  }

  return (
    <Card className="space-y-4 p-4">
      <h2 className="section-label">
        {t("recruitment.control.staffTitle")}
      </h2>

      <div className="flex items-start gap-2 rounded-md bg-muted/60 p-3 text-xs">
        <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-medium">{t("recruitment.control.staffNoteTitle")}</p>
          <p className="text-muted-foreground">{t("recruitment.control.staffNoteBody")}</p>
        </div>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("recruitment.control.staffEmpty")}</p>
      ) : (
        <ul className="divide-y divide-border/70">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm">{m.name ?? m.email}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {t(`recruitment.roles.${m.role}` as StringKey)}
                  {/* Their app role is shown alongside, so it is visible that the
                      two are independent. */}
                  <span className="ml-1.5 opacity-70">({m.appRole})</span>
                </p>
              </div>
              {m.isActive ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground"
                  disabled={disabled || pending}
                  onClick={() => revoke(m.id)}
                >
                  {t("recruitment.control.staffRevoke")}
                </Button>
              ) : (
                <Badge className="shrink-0 bg-muted font-normal text-muted-foreground">
                  {t("recruitment.groups.archived")}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t border-border/70 pt-3">
        <div className="space-y-1.5">
          <Label htmlFor="staff-email" className="text-xs">
            {t("recruitment.control.staffEmailLabel")}
          </Label>
          <Input
            id="staff-email"
            type="email"
            value={email}
            disabled={disabled || pending}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("admin.users.inviteEmailPlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("recruitment.control.staffRoleLabel")}</Label>
          <Select
            value={role}
            onValueChange={(v) => setRole((v ?? "JC") as RecruitmentRole)}
            disabled={disabled || pending}
          >
            <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(`recruitment.roles.${r}` as StringKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          disabled={disabled || pending || !email.includes("@")}
          onClick={assign}
        >
          {t("recruitment.control.staffAdd")}
        </Button>
      </div>
    </Card>
  )
}
