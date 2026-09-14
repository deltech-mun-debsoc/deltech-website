"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { resendEmail } from "../registrations/actions"

interface FailedLog {
  id: string
  template: string
  toEmail: string
  error: string | null
  sentAt: string
  delegateId: string | null
}

// Surfaces recent failed email sends on the dashboard so a Resend blip during
// an allotment blast is noticed by staff, not discovered by a delegate who
// never got their committee. Resend reuses the existing resendEmail action
// (resendByLogId), only delegate-linked templates can be replayed by logId.
export function FailedEmailsCard({ count, logs }: { count: number; logs: FailedLog[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const resend = (id: string) => {
    setPendingId(id)
    startTransition(async () => {
      const result = await resendEmail(id)
      if (result.success) {
        toast.success("Email resent.")
        router.refresh()
      } else {
        toast.error(result.error ?? "Resend failed.")
      }
      setPendingId(null)
    })
  }

  return (
    <div className="editorial-card border-destructive/30 p-6">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-destructive" />
        <h2 className="font-heading text-lg">
          {count} failed email{count === 1 ? "" : "s"}
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        These sends failed. Resend the delegate-linked ones here; others need re-triggering from
        their own flow.
      </p>
      <div className="mt-4 divide-y divide-border/60">
        {logs.map((log) => (
          <div key={log.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm">
                <span className="font-mono text-xs text-muted-foreground">{log.template}</span>
                {" · "}
                {log.toEmail}
              </p>
              {log.error && (
                <p className="truncate text-xs text-destructive/80">{log.error}</p>
              )}
            </div>
            {log.delegateId ? (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={pendingId === log.id}
                onClick={() => resend(log.id)}
              >
                {pendingId === log.id ? "Resending…" : "Resend"}
              </Button>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">not resendable here</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
