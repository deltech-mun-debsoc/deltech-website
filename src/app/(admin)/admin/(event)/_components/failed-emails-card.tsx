"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle } from "lucide-react"
import Link from "next/link"
import { Button, buttonVariants } from "@/components/ui/button"
import { resendEmail } from "../registrations/actions"
import { EMAIL_STATUS, emailLabel } from "../registrations/_lib/status"

interface FailedLog {
  id: string
  template: string
  status: string
  toEmail: string
  error: string | null
  sentAt: string
  delegateId: string | null
}

// Surfaces emails that went wrong and were not put right since, so a blip during
// an allotment blast is noticed by staff, not discovered by a delegate who never
// got their committee. A send builds the CURRENT notice for the delegate's
// current address. A bounce or spam complaint is fixed, not retried.
export function FailedEmailsCard({ count, logs }: { count: number; logs: FailedLog[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const resend = (id: string) => {
    setPendingId(id)
    startTransition(async () => {
      const result = await resendEmail(id)
      if (result.success) {
        toast.success("Sent.")
        router.refresh()
      } else {
        toast.error(result.error ?? "It did not send.")
      }
      setPendingId(null)
    })
  }

  return (
    <div className="editorial-card border-destructive/30 p-6">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-destructive" />
        <h2 className="font-heading text-lg">
          {count === 1 ? "1 email needs you" : `${count} emails need you`}
        </h2>
      </div>
      <div className="mt-4 divide-y divide-border/60">
        {logs.map((log) => (
          <div key={log.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm">
                <span className="font-medium">{emailLabel(log.template)}</span>
                {" · "}
                {log.toEmail}
                {" · "}
                <span className="text-destructive">{EMAIL_STATUS[log.status]?.label ?? log.status.toLowerCase()}</span>
              </p>
              {log.error && (
                <p className="truncate text-xs text-destructive/80">{log.error}</p>
              )}
            </div>
            {log.delegateId ? (
              <div className="flex shrink-0 gap-2">
              <Link
                href={`/admin/registrations?q=${encodeURIComponent(log.toEmail)}`}
                className={buttonVariants({ variant: log.status === "FAILED" ? "ghost" : "outline", size: "sm" })}
              >
                Fix the address
              </Link>
              {log.status === "FAILED" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={pendingId === log.id}
                  onClick={() => resend(log.id)}
                >
                  {pendingId === log.id ? "Sending…" : "Send the current version"}
                </Button>
              )}
              </div>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">Retry from the mail's own page</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
