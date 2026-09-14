"use client"

import { formatDate } from "@/lib/datetime"
import { useState, useEffect, useCallback, useTransition } from "react"
import Link from "next/link"
import { X, Edit2, CheckCircle, RefreshCw, Gift, Clock, Link2, Mail, ChevronDown, Armchair, AlertCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { draftMailForDelegates } from "../../mailer/actions"
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from "@/components/ui/drawer"
import { Button, buttonVariants } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { SerializedDelegate, EmailLogEntry } from "../_lib/types"
import { statusMeta, EMAIL_LABEL } from "../_lib/status"
import { DelegateEditForm } from "./delegate-edit-form"
import {
  markPaidOffline,
  resendEmail,
  compDelegate,
  cancelDelegate,
  waitlistDelegate,
  regeneratePaymentLink,
  getDelegateEmailLogs,
  getDelegateContacts,
  logContact,
  type ContactEntry,
} from "../actions"

interface Props {
  delegate: SerializedDelegate | null
  committees: { id: string; name: string }[]
  intra?: boolean
  onClose: () => void
  onUpdated: (updated: SerializedDelegate) => void
}

// What a secretariat member actually does when chasing a delegate. Kept short on
// purpose: a long list slows logging a call to the point that nobody bothers.
const CONTACT_OPTIONS = [
  { value: "CALLED_NO_ANSWER", label: "No answer" },
  { value: "CALLED_REACHED", label: "Spoke to them" },
  { value: "CALLED_BUSY", label: "Busy, call back" },
  { value: "PROMISED_TO_PAY", label: "Promised to pay" },
  { value: "WHATSAPP_SENT", label: "WhatsApp sent" },
  { value: "EMAIL_SENT", label: "Emailed" },
  { value: "WRONG_NUMBER", label: "Wrong number" },
  { value: "NOT_INTERESTED", label: "Not coming" },
  { value: "NOTE", label: "Note" },
] as const

function outcomeLabel(value: string): string {
  return CONTACT_OPTIONS.find((o) => o.value === value)?.label ?? value
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right break-words text-foreground">{children}</span>
    </div>
  )
}

// Collapsed by default unless it holds something that needs attention, so the
// drawer opens on who they are and what to do next, not on every field they gave.
function Section({
  title,
  hint,
  alert,
  defaultOpen = false,
  children,
}: {
  title: string
  hint?: React.ReactNode
  alert?: boolean
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details open={defaultOpen} className="group border-b border-border/60 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 py-4 [&::-webkit-details-marker]:hidden">
        <span className="font-medium">{title}</span>
        {hint !== undefined && (
          <span className={cn("text-sm", alert ? "font-medium text-destructive" : "text-muted-foreground")}>{hint}</span>
        )}
        <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="pb-5">{children}</div>
    </details>
  )
}

export function DelegateDrawer({ delegate, committees, intra = false, onClose, onUpdated }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [resendTarget, setResendTarget] = useState<EmailLogEntry | null>(null)
  const [resending, setResending] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [emailLogs, setEmailLogs] = useState<EmailLogEntry[] | null>(null)
  const [contacts, setContacts] = useState<ContactEntry[] | null>(null)
  const [outcome, setOutcome] = useState<string>("CALLED_NO_ANSWER")
  const [contactNote, setContactNote] = useState("")
  const [followUpLocal, setFollowUpLocal] = useState("")
  const [savingContact, setSavingContact] = useState(false)

  const delegateId = delegate?.id ?? null
  const loadLogs = useCallback(() => {
    if (!delegateId) return
    getDelegateEmailLogs(delegateId)
      .then(setEmailLogs)
      .catch(() => setEmailLogs([]))
  }, [delegateId])

  useEffect(() => {
    setEmailLogs(null)
    loadLogs()
  }, [loadLogs])

  useEffect(() => {
    setContacts(null)
    setContactNote("")
    setFollowUpLocal("")
    setEditing(false)
    if (!delegateId) return
    getDelegateContacts(delegateId)
      .then(setContacts)
      .catch(() => setContacts([]))
  }, [delegateId])

  const saveContact = () => {
    if (!delegateId) return
    setSavingContact(true)
    logContact(delegateId, {
      outcome,
      note: contactNote,
      // Built here, in the browser's own zone, so a time picked in IST is not
      // reinterpreted as UTC on the server.
      followUpAt: followUpLocal ? new Date(followUpLocal).toISOString() : null,
    })
      .then((res) => {
        if (!res.success) {
          toast.error(res.error ?? "Could not save the log entry.")
          return
        }
        setContacts(res.entries ?? [])
        setContactNote("")
        setFollowUpLocal("")
        toast.success("Logged.")
      })
      .finally(() => setSavingContact(false))
  }

  const runAction = (
    fn: () => Promise<{ success: boolean; error?: string; warning?: string; delegate?: SerializedDelegate }>,
    successMsg: string,
    onSuccess?: () => void,
  ) => {
    startTransition(async () => {
      const result = await fn()
      if (result.success && result.delegate) {
        if (result.warning) toast.warning(result.warning, { duration: 10000 })
        else toast.success(successMsg)
        onUpdated(result.delegate)
        onSuccess?.()
      } else {
        toast.error(result.error ?? "Action failed.")
      }
    })
  }

  const confirmResend = () => {
    if (!resendTarget) return
    setResending(true)
    resendEmail(resendTarget.id)
      .then((res) => {
        if (res.success) {
          toast.success("Email sent again.")
          setResendTarget(null)
          loadLogs()
        } else toast.error(res.error ?? "Could not send it again.")
      })
      .finally(() => setResending(false))
  }

  const committeeName = (id: string | null) => (id ? committees.find((c) => c.id === id)?.name ?? "Unknown committee" : null)

  const handleClose = () => {
    setEditing(false)
    setCancelOpen(false)
    onClose()
  }

  const d = delegate
  const meta = d ? statusMeta(d.status) : null
  const failedEmails = emailLogs?.filter((l) => l.status === "FAILED").length ?? 0
  const followUpDue = !!d?.nextFollowUpAt && new Date(d.nextFollowUpAt) <= new Date()
  const seat = d?.allotment ? `${committeeName(d.allotment.committeeId)} · ${d.allotment.portfolio.name}` : null
  const unpaid = d?.payment && ["PENDING", "SENT", "FAILED"].includes(d.payment.status)
  const choices = d
    ? [
        { rank: "1st", committee: committeeName(d.pref1CommitteeId), seat: d.pref1Portfolio },
        ...(d.coDelegate ? [] : [{ rank: "2nd", committee: committeeName(d.pref2CommitteeId), seat: d.pref2Portfolio }]),
      ].filter((c) => c.committee)
    : []

  return (
    <>
      {/* Not modal while one of its confirmations is up: a modal drawer traps focus
          and pointer events, so the confirmation (portalled outside it) would open
          behind it and could not be pressed. */}
      <Drawer
        open={!!d}
        onOpenChange={(open) => { if (!open && !resendTarget && !cancelOpen) handleClose() }}
        direction="right"
        modal={!resendTarget && !cancelOpen}
      >
        <DrawerContent className="flex flex-col overflow-hidden sm:max-w-xl data-[vaul-drawer-direction=right]:sm:max-w-xl">
          <DrawerHeader className="flex flex-row items-start gap-3 border-b border-border/60 px-6 py-5">
            <div className="min-w-0 flex-1">
              <DrawerTitle className="truncate font-heading text-2xl font-medium">{d?.fullName ?? "Delegate"}</DrawerTitle>
              {d && meta && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", meta.pill)}>
                    <span className={cn("size-1.5 rounded-full", meta.dot)} />
                    {meta.label}
                  </span>
                  <span className="truncate">{intra ? d.rollNumber ?? "No roll number" : d.institution}</span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {!editing && d && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Write them an email"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await draftMailForDelegates({ ids: [d.id] })
                        if (!r.success) {
                          toast.error(r.error)
                          return
                        }
                        router.push(`/admin/mailer/${r.id}`)
                      })
                    }
                  >
                    <Mail className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Edit details" onClick={() => setEditing(true)}>
                    <Edit2 className="size-4" />
                  </Button>
                </>
              )}
              <DrawerClose asChild>
                <Button variant="ghost" size="icon" title="Close">
                  <X className="size-4" />
                </Button>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {d &&
              (editing ? (
                <DelegateEditForm
                  delegate={d}
                  intra={intra}
                  onSuccess={(updated) => {
                    setEditing(false)
                    onUpdated(updated)
                  }}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <div className="space-y-6">
                  {/* The one thing to do next for this delegate. */}
                  <div className="rounded-xl border border-border/70 bg-muted/30 p-5">
                    {(d.status === "REGISTERED" || d.status === "WAITLISTED") && (
                      <>
                        <p className="font-medium">{d.status === "WAITLISTED" ? "On the waitlist" : "Waiting for a seat"}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {choices[0] ? `Wants ${choices[0].committee}${choices[0].seat ? ` · ${choices[0].seat}` : ""}` : "Has not chosen a committee."}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link href={`/admin/allotment?delegate=${d.id}`} className={buttonVariants({ size: "sm" })}>
                            <Armchair className="size-4" /> Give a seat
                          </Link>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() =>
                              runAction(
                                () => waitlistDelegate(d.id, d.status === "REGISTERED"),
                                d.status === "REGISTERED" ? "Moved to the waitlist." : "Back to waiting for a seat.",
                              )
                            }
                          >
                            <Clock className="size-4" /> {d.status === "REGISTERED" ? "Waitlist" : "Take off waitlist"}
                          </Button>
                        </div>
                      </>
                    )}
                    {(d.status === "ALLOTTED" || d.status === "PAYMENT_SENT") && (
                      <>
                        <p className="font-medium">{seat}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {d.payment ? `Waiting on ₹${d.payment.amountInr.toLocaleString("en-IN")}` : "No payment request yet."}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {unpaid && (
                            <Button size="sm" disabled={isPending} onClick={() => runAction(() => markPaidOffline(d.id), "Marked as paid. They are confirmed.")}>
                              <CheckCircle className="size-4" /> Mark as paid
                            </Button>
                          )}
                          <Button variant="outline" size="sm" disabled={isPending} onClick={() => runAction(() => regeneratePaymentLink(d.id), "New payment link sent.")}>
                            <Link2 className="size-4" /> New pay link
                          </Button>
                          <Button variant="ghost" size="sm" disabled={isPending} onClick={() => runAction(() => compDelegate(d.id), "Made free. They are confirmed.")}>
                            <Gift className="size-4" /> Make free
                          </Button>
                        </div>
                      </>
                    )}
                    {d.status === "CONFIRMED" && (
                      <>
                        <p className="font-medium">{seat ?? "Confirmed"}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {d.payment && d.payment.amountInr > 0 ? `Paid ₹${d.payment.amountInr.toLocaleString("en-IN")}` : "Confirmed, nothing to pay."}
                        </p>
                      </>
                    )}
                    {d.status === "CANCELLED" && (
                      <>
                        <p className="font-medium">Removed from the event</p>
                        <p className="mt-1 text-sm text-muted-foreground">Their seat, if they had one, went back on the board.</p>
                      </>
                    )}
                    {followUpDue && (
                      <p className="mt-4 flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                        <AlertCircle className="size-4" /> {`Follow-up due since ${formatDate(d.nextFollowUpAt!)}`}
                      </p>
                    )}
                    {d.query && (
                      <p className="mt-4 flex items-start gap-2 text-sm">
                        <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                        <span>
                          <span className="font-medium">They asked: </span>
                          {d.query}
                        </span>
                      </p>
                    )}
                  </div>

                  <div className="text-sm">
                    <Section title="Contact" defaultOpen>
                      <div className="divide-y divide-border/40">
                        <Row label="Email">
                          <a href={`mailto:${d.email}`} className="hover:underline">{d.email}</a>
                        </Row>
                        <Row label="WhatsApp">
                          <a href={`https://wa.me/${d.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{d.whatsapp}</a>
                        </Row>
                        {d.altPhone && <Row label="Other phone">{d.altPhone}</Row>}
                      </div>
                    </Section>

                    <Section title="Application" hint={`registered ${formatDate(d.createdAt)}`}>
                      <div className="divide-y divide-border/40">
                        {choices.length === 0 ? (
                          <Row label="Choices">None given</Row>
                        ) : (
                          choices.map((c) => (
                            <Row key={c.rank} label={`${c.rank} choice`}>
                              {`${c.committee}${c.seat ? ` · ${c.seat}` : ""}`}
                            </Row>
                          ))
                        )}
                        {!intra && <Row label="College">{d.isDtu ? "DTU" : d.institution}</Row>}
                        {intra && d.rollNumber && <Row label="Roll number">{d.rollNumber}</Row>}
                        {!intra && d.needsAccommodation && <Row label="Accommodation">{d.outsideNcr ? "Needed, from outside NCR" : "Needed"}</Row>}
                        {d.reference && <Row label="Heard about us">{d.reference}</Row>}
                        <Row label="Came from">{d.source === "SELF" ? "Website form" : d.source === "MANUAL" ? "Added by staff" : d.source === "CROSS_DEL" ? "Cross delegation" : d.source.toLowerCase()}</Row>
                      </div>
                      {d.munExperience && (
                        <div className="mt-3 rounded-lg bg-muted/40 p-3">
                          <p className="text-xs text-muted-foreground">MUN experience</p>
                          <p className="mt-1 whitespace-pre-wrap">{d.munExperience}</p>
                        </div>
                      )}
                    </Section>

                    {d.coDelegate && (
                      <Section title="Co-delegate" hint={d.coDelegate.fullName}>
                        <div className="divide-y divide-border/40">
                          <Row label="Email">{d.coDelegate.email}</Row>
                          <Row label="Phone">{d.coDelegate.phone}</Row>
                          {d.coDelegate.institution && <Row label="College">{d.coDelegate.institution}</Row>}
                        </div>
                      </Section>
                    )}

                    {d.payment && (
                      <Section title="Payment" hint={`₹${d.payment.amountInr.toLocaleString("en-IN")} · ${d.payment.status.toLowerCase()}`}>
                        <div className="divide-y divide-border/40">
                          <Row label="Through">{d.payment.provider.replace(/_/g, " ")}</Row>
                          {d.payment.confirmedAt && <Row label="Confirmed">{formatDate(d.payment.confirmedAt)}</Row>}
                          {d.payment.paymentLink && (
                            <Row label="Pay link">
                              <button
                                type="button"
                                className="text-primary hover:underline"
                                onClick={() => {
                                  void navigator.clipboard.writeText(d.payment!.paymentLink!)
                                  toast.success("Link copied.")
                                }}
                              >
                                Copy link
                              </button>
                            </Row>
                          )}
                        </div>
                      </Section>
                    )}

                    <Section
                      title="Calls and notes"
                      hint={contacts === null ? undefined : contacts.length === 0 ? "none yet" : `${contacts.length}`}
                      defaultOpen={followUpDue}
                    >
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-1.5">
                          {CONTACT_OPTIONS.map((o) => (
                            <button
                              key={o.value}
                              type="button"
                              onClick={() => setOutcome(o.value)}
                              className={cn(
                                "rounded-full border px-3 py-1 text-xs transition-colors",
                                outcome === o.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                              )}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                        <textarea
                          value={contactNote}
                          onChange={(e) => setContactNote(e.target.value)}
                          rows={2}
                          maxLength={1000}
                          placeholder={outcome === "NOTE" ? "What should the team know?" : "What was said (optional)"}
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                        />
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            Follow up by (optional)
                            <input
                              type="datetime-local"
                              value={followUpLocal}
                              onChange={(e) => setFollowUpLocal(e.target.value)}
                              className="h-9 rounded-lg border border-input bg-background px-2 text-xs"
                            />
                          </label>
                          <Button size="sm" className="ml-auto" disabled={savingContact} onClick={saveContact}>
                            {savingContact ? "Saving…" : "Log it"}
                          </Button>
                        </div>
                        {contacts && contacts.length > 0 && (
                          <ul className="space-y-2 pt-2">
                            {contacts.map((c) => (
                              <li key={c.id} className="rounded-lg bg-muted/40 px-3 py-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-medium">{outcomeLabel(c.outcome)}</span>
                                  <span className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</span>
                                </div>
                                {c.note && <p className="mt-1 whitespace-pre-wrap text-sm">{c.note}</p>}
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {c.createdBy}
                                  {c.followUpAt && ` · follow up by ${formatDate(c.followUpAt)}`}
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </Section>

                    <Section
                      title="Emails"
                      hint={emailLogs === null ? undefined : failedEmails > 0 ? `${failedEmails} failed` : emailLogs.length === 0 ? "none yet" : `${emailLogs.length} sent`}
                      alert={failedEmails > 0}
                      defaultOpen={failedEmails > 0}
                    >
                      {emailLogs && emailLogs.length > 0 ? (
                        <ul className="space-y-1">
                          {emailLogs.map((log) => (
                            <li key={log.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/40">
                              <span className={cn("size-2 shrink-0 rounded-full", log.status === "FAILED" ? "bg-red-500" : "bg-emerald-500")} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate">{EMAIL_LABEL[log.template] ?? log.template}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatDate(log.sentAt)}
                                  {log.status === "FAILED" && <span className="text-destructive"> · did not send</span>}
                                </p>
                              </div>
                              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setResendTarget(log)}>
                                <RefreshCw className="size-3.5" /> Send again
                              </Button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-muted-foreground">{emailLogs === null ? "Loading…" : "Nothing sent yet."}</p>
                      )}
                    </Section>
                  </div>

                  {d.status !== "CANCELLED" && (
                    <div className="flex justify-end pt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={isPending}
                        onClick={() => setCancelOpen(true)}
                      >
                        Remove from event
                      </Button>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </DrawerContent>
      </Drawer>

      <ConfirmDialog
        open={!!resendTarget}
        onOpenChange={(open) => !open && setResendTarget(null)}
        title="Send this email again?"
        description={
          resendTarget && d
            ? `“${EMAIL_LABEL[resendTarget.template] ?? resendTarget.template}” goes to ${d.email} again, exactly as it was first sent.`
            : ""
        }
        confirmLabel="Send again"
        pending={resending}
        onConfirm={confirmResend}
      />

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Remove from this event?"
        description={d ? `${d.fullName} is removed and any seat they hold goes back on the board. Unpaid payment links are dropped. A settled payment has to be refunded first.` : ""}
        confirmLabel="Remove from event"
        destructive
        pending={isPending}
        onConfirm={() =>
          d && runAction(() => cancelDelegate(d.id), "Removed from the event. Their seat is free again.", () => setCancelOpen(false))
        }
      />
    </>
  )
}
