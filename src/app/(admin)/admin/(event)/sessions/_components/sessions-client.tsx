"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { t } from "@/content/strings"
import { formatTime } from "@/lib/datetime"
import { addChair, closeSession, openSession, removeChair } from "../actions"

export interface SessionRow {
  id: string
  name: string
  chairs: { userId: string; email: string; name: string | null }[]
  session: { id: string; version: number; startedAt: string | null; inRoom: number; total: number } | null
}

type Pending = { kind: "close"; committee: SessionRow } | { kind: "remove"; committee: SessionRow; userId: string; email: string }

export function SessionsClient({ committees }: { committees: SessionRow[] }) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [confirming, setConfirming] = useState<Pending | null>(null)

  const run = (fn: () => Promise<{ success: boolean; error?: string; warning?: string }>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn()
      if (!res.success) toast.error(res.error)
      else if (res.warning) toast.warning(res.warning)
      if (res.success) after?.()
      setConfirming(null)
      router.refresh()
    })

  const onConfirm = () => {
    if (!confirming) return
    if (confirming.kind === "close") {
      const s = confirming.committee.session
      if (s) run(() => closeSession(s.id, s.version))
    } else {
      const { committee, userId } = confirming
      run(() => removeChair(committee.id, userId))
    }
  }

  return (
    <>
      <ul className="grid gap-4 lg:grid-cols-2">
        {committees.map((c) => (
          <CommitteeCard
            key={c.id}
            committee={c}
            busy={busy}
            onOpen={() => run(() => openSession(c.id))}
            onClose={() => setConfirming({ kind: "close", committee: c })}
            onAddChair={(email, done) => run(() => addChair(c.id, email), done)}
            onRemoveChair={(userId, email) => setConfirming({ kind: "remove", committee: c, userId, email })}
          />
        ))}
      </ul>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirming?.kind === "close" ? t("sessions.close") : t("sessions.removeChair")}
        description={
          confirming?.kind === "close"
            ? t("sessions.confirmClose")
            : confirming
              ? t("sessions.confirmRemove", { email: confirming.email })
              : ""
        }
        confirmLabel={confirming?.kind === "close" ? t("sessions.close") : t("sessions.removeChair")}
        onConfirm={onConfirm}
        destructive
        pending={busy}
      />
    </>
  )
}

function CommitteeCard({
  committee,
  busy,
  onOpen,
  onClose,
  onAddChair,
  onRemoveChair,
}: {
  committee: SessionRow
  busy: boolean
  onOpen: () => void
  onClose: () => void
  onAddChair: (email: string, done: () => void) => void
  onRemoveChair: (userId: string, email: string) => void
}) {
  const [email, setEmail] = useState("")
  const { session, chairs } = committee

  return (
    <li className="space-y-5 rounded-lg border border-border/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-heading text-lg">{committee.name}</h2>
          {session ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge>
                {session.startedAt ? t("sessions.inSession", { time: formatTime(session.startedAt) }) : t("sessions.open")}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {t("sessions.present", { inRoom: session.inRoom, total: session.total })}
              </span>
            </div>
          ) : (
            <Badge variant="outline">{t("sessions.notInSession")}</Badge>
          )}
        </div>
        {session ? (
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("sessions.close")}
          </Button>
        ) : (
          <Button onClick={onOpen} disabled={busy || chairs.length === 0}>
            {t("sessions.open")}
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <p className="data-label text-muted-foreground">{t("sessions.chairs")}</p>
        {chairs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("sessions.noChairs")}</p>
        ) : (
          <ul className="divide-y divide-border/70 rounded-md border border-border/70">
            {chairs.map((ch) => (
              <li key={ch.userId} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{ch.name ?? ch.email}</p>
                  {ch.name && <p className="truncate text-xs text-muted-foreground">{ch.email}</p>}
                </div>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRemoveChair(ch.userId, ch.email)}>
                  {t("sessions.removeChair")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (email.trim()) onAddChair(email, () => setEmail(""))
          }}
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("sessions.chairEmail")}
            aria-label={t("sessions.chairEmail")}
            disabled={busy}
          />
          <Button type="submit" variant="outline" disabled={busy || !email.trim()}>
            {t("sessions.addChair")}
          </Button>
        </form>
      </div>
    </li>
  )
}
