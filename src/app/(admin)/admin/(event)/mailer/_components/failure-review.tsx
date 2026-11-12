"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import type { RecoveryAction } from "@/lib/mailer/recovery"
import { retryFailedRecipients } from "../actions"

export interface FailedRecipient {
  id: string
  name: string | null
  email: string
  action: RecoveryAction
}

// Who this mail did not reach, why, and the one safe thing to do about each.
// Retrying sends to these people only; anyone who got it cannot get it twice.
export function FailureReview({ campaignId, rows, isAdmin }: { campaignId: string; rows: FailedRecipient[]; isAdmin: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const retryable = rows.filter((r) => r.action.kind === "retry" || (r.action.kind === "check" && checked.has(r.id)))

  const retry = () =>
    startTransition(async () => {
      const result = await retryFailedRecipients(
        campaignId,
        retryable.map((r) => r.id),
        [...checked],
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${result.queued} queued again${result.refused ? `; ${result.refused} could not be` : ""}.`)
      setChecked(new Set())
      router.refresh()
    })

  return (
    <section className="space-y-3">
      <h2 className="font-heading text-lg">{`Review failures (${rows.length})`}</h2>
      <ul className="divide-y divide-border/60 rounded-lg border border-border">
        {rows.map((r) => (
          <li key={r.id} className="space-y-1 px-4 py-3 text-sm">
            <p>
              <span className="font-medium">{r.name ?? r.email}</span>
              <span className="text-muted-foreground">{` · ${r.email}`}</span>
            </p>
            <p className="text-xs text-muted-foreground">{r.action.cause}</p>
            {r.action.kind === "retry" && (
              <p className="text-xs">{r.action.newEmail ? `Will go to their new address, ${r.action.newEmail}.` : "Can be sent again."}</p>
            )}
            {r.action.kind === "fix-address" && (
              <p className="text-xs">
                <Link href={`/admin/registrations?q=${encodeURIComponent(r.email)}`} className="text-primary underline-offset-2 hover:underline">
                  Fix their address
                </Link>
                {" first. Sending to this one again does nothing useful."}
              </p>
            )}
            {r.action.kind === "check" && (
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={checked.has(r.id)}
                  disabled={!isAdmin}
                  onChange={(e) => {
                    const next = new Set(checked)
                    if (e.target.checked) next.add(r.id)
                    else next.delete(r.id)
                    setChecked(next)
                  }}
                />
                {"It may have arrived. I checked with them and they did not get it."}
              </label>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <Button disabled={pending || retryable.length === 0} onClick={retry}>
          {pending ? "Queuing…" : `Retry ${retryable.length} failed ${retryable.length === 1 ? "recipient" : "recipients"}`}
        </Button>
      )}
    </section>
  )
}
