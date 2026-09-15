"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Ban, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { setUserDisabled } from "@/app/(admin)/admin/users/actions"

export interface ParticipantRow {
  id: string
  email: string
  name: string | null
  disabled: boolean
  createdAt: string
  delegate: {
    publicToken: string
    fullName: string
    institution: string
    status: string
    checkedIn: boolean
  } | null
}

const STATUS_TONE: Record<string, string> = {
  REGISTERED: "bg-muted text-muted-foreground",
  ALLOTTED: "bg-secondary text-secondary-foreground",
  PAYMENT_SENT: "bg-accent text-accent-foreground",
  CONFIRMED: "bg-[var(--teal-100)] text-[var(--teal-700)]",
  CANCELLED: "bg-[var(--signal-soft)] text-[var(--ink-soft)]",
  WAITLISTED: "bg-accent text-accent-foreground",
}

// Deliberately narrower than UsersTable: no role select and no delete. A
// participant's role is not a thing to fiddle with from here, and deleting the
// account would orphan their application. Disable is kept, because it is the one
// action that genuinely applies (revoke access, keep the record).
export function ParticipantsTable({
  rows,
  canManage,
}: {
  rows: ParticipantRow[]
  canManage: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No participant accounts match.</p>
  }

  function toggleDisabled(row: ParticipantRow) {
    setBusy(row.id)
    startTransition(async () => {
      const result = await setUserDisabled(row.id, !row.disabled)
      setBusy(null)
      if (!result.success) {
        toast.error(result.error ?? "Could not update that account.")
        return
      }
      toast.success(row.disabled ? "Account re-enabled." : "Account disabled.")
      router.refresh()
    })
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border/70">
      <table className="w-full min-w-[44rem] text-left text-sm">
        <thead>
          <tr className="border-b border-border/70 bg-card">
            <th className="px-3 py-2 font-medium">Account</th>
            <th className="px-3 py-2 font-medium">Application</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Signed up</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={cn("border-b border-border/40 last:border-0", row.disabled && "opacity-55")}
            >
              <td className="px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.name ?? row.email}</p>
                  {row.name && (
                    <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                  )}
                </div>
              </td>

              <td className="px-3 py-2">
                {row.delegate ? (
                  <div className="min-w-0">
                    <p className="truncate">{row.delegate.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.delegate.institution}
                    </p>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">Not submitted</span>
                )}
              </td>

              <td className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {row.delegate && (
                    <Badge
                      className={cn(
                        "font-normal",
                        STATUS_TONE[row.delegate.status] ?? "bg-muted text-muted-foreground",
                      )}
                    >
                      {row.delegate.status.replace("_", " ")}
                    </Badge>
                  )}
                  {row.delegate?.checkedIn && (
                    <Badge className="bg-[var(--teal-100)] font-normal text-[var(--teal-700)]">
                      Checked in
                    </Badge>
                  )}
                  {row.disabled && (
                    <Badge className="bg-muted font-normal text-muted-foreground">Disabled</Badge>
                  )}
                </div>
              </td>

              <td className="px-3 py-2 text-xs text-muted-foreground">
                <time dateTime={row.createdAt}>{row.createdAt.slice(0, 10)}</time>
              </td>

              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-1.5">
                  {row.delegate && (
                    <Link
                      href={`/admin/registrations?q=${encodeURIComponent(row.email)}`}
                      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      Open
                    </Link>
                  )}
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground"
                      disabled={pending && busy === row.id}
                      onClick={() => toggleDisabled(row)}
                    >
                      {row.disabled ? (
                        <>
                          <RotateCcw className="size-3.5" /> Enable
                        </>
                      ) : (
                        <>
                          <Ban className="size-3.5" /> Disable
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
