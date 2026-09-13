"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { MERGE_FIELDS } from "@/lib/mailer/merge"
import { MAIL_PRESETS } from "@/lib/mailer/presets"
import { presetDraft, previewMail, saveCampaign, scheduleCampaign, sendTestMail, type CampaignInput } from "../actions"

const STATUSES = ["REGISTERED", "ALLOTTED", "PAYMENT_SENT", "CONFIRMED", "WAITLISTED", "CANCELLED"] as const
const PAYMENTS = ["PENDING", "SENT", "PAID", "FAILED", "COMPED", "OFFLINE"] as const
type Tri = "any" | "yes" | "no"

interface DelegateFilters {
  statuses: string[]
  committeeIds: string[]
  allotted: Tri
  paymentStatuses: string[]
  isDtu: Tri
  needsAccommodation: Tri
  checkedIn: Tri
}

const EMPTY_DELEGATE: DelegateFilters = {
  statuses: [], committeeIds: [], allotted: "any", paymentStatuses: [], isDtu: "any", needsAccommodation: "any", checkedIn: "any",
}

export interface ComposerCampaign {
  id: string
  audience: "DELEGATES" | "CONTACTS"
  filters: unknown
  preset: string
  subject: string
  body: string
  ctaLabel: string | null
  ctaUrl: string | null
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
    >
      {children}
    </button>
  )
}

function TriPick({ label, value, onChange }: { label: string; value: Tri; onChange: (v: Tri) => void }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 text-muted-foreground">{label}</span>
      {(["any", "yes", "no"] as const).map((v) => (
        <Chip key={v} on={value === v} onClick={() => onChange(v)}>{v}</Chip>
      ))}
    </div>
  )
}

export function Composer({
  campaign,
  committees,
  tags,
  prOn,
  isAdmin,
}: {
  campaign?: ComposerCampaign
  committees: { id: string; name: string }[]
  tags: string[]
  prOn: boolean
  isAdmin: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [audience, setAudience] = useState<"DELEGATES" | "CONTACTS">(campaign?.audience ?? "DELEGATES")
  const [delegateFilters, setDelegateFilters] = useState<DelegateFilters>(
    campaign?.audience === "DELEGATES" ? { ...EMPTY_DELEGATE, ...(campaign.filters as Partial<DelegateFilters>) } : EMPTY_DELEGATE,
  )
  const [contactTags, setContactTags] = useState<string[]>(
    campaign?.audience === "CONTACTS" ? ((campaign.filters as { tags?: string[] })?.tags ?? []) : [],
  )
  const [preset, setPreset] = useState(campaign?.preset ?? "custom")
  const [subject, setSubject] = useState(campaign?.subject ?? "")
  const [body, setBody] = useState(campaign?.body ?? "Hi {firstName},\n\n")
  const [ctaLabel, setCtaLabel] = useState(campaign?.ctaLabel ?? "")
  const [ctaUrl, setCtaUrl] = useState(campaign?.ctaUrl ?? "")
  const [scheduleLocal, setScheduleLocal] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [preview, setPreview] = useState<{ count: number; html: string; sampleTo: string | null; unfilled: string[]; dailyCap: number; noEvent: boolean } | null>(null)

  const input = (): CampaignInput => ({
    id: campaign?.id,
    audience,
    filters: audience === "DELEGATES" ? delegateFilters : { tags: contactTags },
    preset,
    subject,
    body,
    ctaLabel: ctaLabel || undefined,
    ctaUrl: ctaUrl || undefined,
  })

  const refreshPreview = () =>
    startTransition(async () => {
      const r = await previewMail(input())
      if (r.success) setPreview(r)
      else toast.error(r.error)
    })

  // The preview and count follow everything that changes what is sent: who it
  // goes to, and the text itself. Debounced, so typing does not render a mail on
  // every keystroke. It used to follow only the filters, so choosing a preset left
  // the previous text in the preview until someone pressed Update preview.
  useEffect(() => {
    const timer = setTimeout(refreshPreview, 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, delegateFilters, contactTags, subject, body, ctaLabel, ctaUrl])

  const applyPreset = (key: string) =>
    startTransition(async () => {
      setPreset(key)
      const d = await presetDraft(key)
      setSubject(d.subject)
      setBody(d.body)
      setCtaLabel(d.ctaLabel ?? "")
      setCtaUrl(d.ctaUrl ?? "")
    })

  const save = (then?: (id: string) => void) =>
    startTransition(async () => {
      const r = await saveCampaign(input())
      if (!r.success) {
        toast.error(r.error)
        return
      }
      toast.success("Draft saved.")
      if (then) then(r.id)
      else if (!campaign) router.replace(`/admin/mailer/${r.id}`)
      else refreshPreview()
    })

  const test = () =>
    startTransition(async () => {
      const r = await sendTestMail(input())
      if (r.success) toast.success(`Test sent to ${r.to}.`)
      else toast.error(r.error)
    })

  const send = () =>
    save((id) =>
      startTransition(async () => {
        const when = scheduleLocal ? new Date(scheduleLocal).toISOString() : null
        const r = await scheduleCampaign(id, when)
        setConfirmOpen(false)
        if (!r.success) {
          toast.error(r.error)
          return
        }
        toast.success(when ? "Scheduled." : "Sending now.")
        router.push(`/admin/mailer/${id}`)
        router.refresh()
      }),
    )

  const presets = MAIL_PRESETS.filter((p) => p.audience === "ANY" || p.audience === audience)

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_1fr]">
      <div className="space-y-6">
        <section className="space-y-3">
          <Label>Who it goes to</Label>
          <div className="flex gap-2">
            <Chip on={audience === "DELEGATES"} onClick={() => setAudience("DELEGATES")}>Delegates of the current event</Chip>
            <Chip on={audience === "CONTACTS"} onClick={() => setAudience("CONTACTS")}>Outreach list (PR)</Chip>
          </div>

          {audience === "DELEGATES" ? (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="w-28 text-muted-foreground">Status</span>
                {STATUSES.map((s) => (
                  <Chip key={s} on={delegateFilters.statuses.includes(s)} onClick={() => setDelegateFilters({ ...delegateFilters, statuses: toggle(delegateFilters.statuses, s) })}>
                    {s.toLowerCase().replace("_", " ")}
                  </Chip>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">No status chosen means everyone except cancelled delegates.</p>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="w-28 text-muted-foreground">Committee</span>
                {committees.map((c) => (
                  <Chip key={c.id} on={delegateFilters.committeeIds.includes(c.id)} onClick={() => setDelegateFilters({ ...delegateFilters, committeeIds: toggle(delegateFilters.committeeIds, c.id) })}>
                    {c.name}
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="w-28 text-muted-foreground">Payment</span>
                {PAYMENTS.map((s) => (
                  <Chip key={s} on={delegateFilters.paymentStatuses.includes(s)} onClick={() => setDelegateFilters({ ...delegateFilters, paymentStatuses: toggle(delegateFilters.paymentStatuses, s) })}>
                    {s.toLowerCase()}
                  </Chip>
                ))}
              </div>
              <TriPick label="Allotted" value={delegateFilters.allotted} onChange={(v) => setDelegateFilters({ ...delegateFilters, allotted: v })} />
              <TriPick label="DTU" value={delegateFilters.isDtu} onChange={(v) => setDelegateFilters({ ...delegateFilters, isDtu: v })} />
              <TriPick label="Accommodation" value={delegateFilters.needsAccommodation} onChange={(v) => setDelegateFilters({ ...delegateFilters, needsAccommodation: v })} />
              <TriPick label="Checked in" value={delegateFilters.checkedIn} onChange={(v) => setDelegateFilters({ ...delegateFilters, checkedIn: v })} />
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-border p-4">
              {!prOn && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  PR mail is switched off. You can draft and test, but it will not send until an admin switches it on from Outreach contacts.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="w-28 text-muted-foreground">Tags</span>
                {tags.length === 0 && <span className="text-muted-foreground">No tags yet. Everyone on the list.</span>}
                {tags.map((t) => (
                  <Chip key={t} on={contactTags.includes(t)} onClick={() => setContactTags(toggle(contactTags, t))}>{t}</Chip>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">Unsubscribed and bounced addresses, and anyone mailed in the last few days, are always left out.</p>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <Label>Start from</Label>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <Chip key={p.key} on={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mail-subject">Subject</Label>
            <Input id="mail-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mail-body">Message</Label>
            <Textarea id="mail-body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="font-mono text-sm" />
            <div className="flex flex-wrap gap-1">
              {MERGE_FIELDS.map((f) => (
                <button key={f.key} type="button" title={f.hint} onClick={() => setBody(`${body}{${f.key}}`)} className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted">
                  {`{${f.key}}`}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mail-cta-label">Button label (optional)</Label>
              <Input id="mail-cta-label" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} maxLength={60} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mail-cta-url">Button link</Label>
              <Input id="mail-cta-url" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://... or {statusLink}" />
            </div>
          </div>
        </section>

        <section className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <Button variant="outline" disabled={pending} onClick={() => save()}>Save draft</Button>
          <Button variant="outline" disabled={pending} onClick={test}>Send me a test</Button>
          <Button variant="outline" disabled={pending} onClick={refreshPreview}>Update preview</Button>
          {isAdmin ? (
            <div className="ml-auto flex items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Send later (optional)
                <input type="datetime-local" value={scheduleLocal} onChange={(e) => setScheduleLocal(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" />
              </label>
              <Button disabled={pending || !preview || (preview.count === 0 && !scheduleLocal)} onClick={() => setConfirmOpen(true)}>
                {scheduleLocal ? "Schedule" : "Send now"}
              </Button>
            </div>
          ) : (
            <p className="ml-auto text-xs text-muted-foreground">An admin sends or schedules it.</p>
          )}
        </section>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium">
            {preview ? `${preview.count} ${preview.count === 1 ? "recipient" : "recipients"}` : "Counting"}
            {preview?.sampleTo && <span className="font-normal text-muted-foreground">{` · previewed as ${preview.sampleTo}`}</span>}
          </span>
          {preview && <span className="text-xs text-muted-foreground">{`Up to ${preview.dailyCap} a day, the rest continue automatically`}</span>}
        </div>
        {preview?.noEvent && audience === "DELEGATES" && (
          <p className="text-xs text-destructive">No event is running, so there are no delegates to mail.</p>
        )}
        {preview && preview.unfilled.length > 0 && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {`Not filled for the previewed recipient: ${preview.unfilled.map((f) => `{${f}}`).join(", ")}. Check the filters or the spelling.`}
          </p>
        )}
        {preview && <iframe title="Mail preview" sandbox="" srcDoc={preview.html} className="h-[720px] w-full rounded-lg border border-border bg-white" />}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => !pending && setConfirmOpen(o)}
        title={scheduleLocal ? "Schedule this mail?" : "Send this mail now?"}
        description={
          scheduleLocal
            ? `It goes out at the chosen time to whoever matches the filters then. ${preview?.count ?? 0} ${(preview?.count ?? 0) === 1 ? "matches" : "match"} right now.`
            : `${preview?.count ?? 0} ${(preview?.count ?? 0) === 1 ? "person" : "people"} will get it. A sent mail cannot be recalled.`
        }
        confirmLabel={scheduleLocal ? "Schedule" : "Send now"}
        pending={pending}
        onConfirm={send}
      />
    </div>
  )
}
