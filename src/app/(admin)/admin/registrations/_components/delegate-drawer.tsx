"use client"

import { formatDate } from "@/lib/datetime"
import { useState, useEffect, useCallback, useTransition } from "react"
import { X, Edit2, CheckCircle, RefreshCw, Gift, Ban, Clock, Link2 } from "lucide-react"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import type { SerializedDelegate, EmailLogEntry } from "../_lib/types"
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
  onClose: () => void
  onUpdated: (updated: SerializedDelegate) => void
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  REGISTERED: "secondary", ALLOTTED: "outline", PAYMENT_SENT: "outline",
  CONFIRMED: "default", CANCELLED: "destructive", WAITLISTED: "secondary",
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm text-foreground">{value ?? "-"}</p>
    </div>
  )
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">{title}</p>
      {children}
    </div>
  )
}

export function DelegateDrawer({ delegate, committees, onClose, onUpdated }: Props) {
  const [editing, setEditing] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [resendingLogId, setResendingLogId] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  // Loaded per-delegate on open, instead of being joined onto every row of the
  // table behind this drawer.
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

  const handleMarkPaid = () => {
    if (!delegate) return
    runAction(() => markPaidOffline(delegate.id), "Marked as paid, delegate confirmed.")
  }

  const committeeMap = new Map(committees.map(c => [c.id, c.name]))

  const handleClose = () => {
    setEditing(false)
    setCancelOpen(false)
    onClose()
  }

  const handleUpdated = (updated: SerializedDelegate) => {
    setEditing(false)
    onUpdated(updated)
  }

  return (
    <>
    <Drawer
      open={!!delegate}
      onOpenChange={(open) => { if (!open) handleClose() }}
      direction="right"
    >
      <DrawerContent className="sm:max-w-lg overflow-hidden flex flex-col">
        <DrawerHeader className="flex items-start justify-between border-b border-border/60 pb-4">
          <div className="min-w-0 flex-1">
            <DrawerTitle className="truncate text-base font-semibold">
              {delegate?.fullName ?? "Delegate"}
            </DrawerTitle>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{delegate?.email}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1 pl-2">
            {!editing && (
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setEditing(true)}>
                <Edit2 className="size-3.5" /> Edit
              </Button>
            )}
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <X className="size-4" />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {delegate && (
            editing ? (
              <DelegateEditForm
                delegate={delegate}
                onSuccess={handleUpdated}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <div className="space-y-6">
                {/* Status badge */}
                <div className="flex items-center justify-between">
                  <Badge variant={STATUS_VARIANT[delegate.status] ?? "secondary"} className="text-xs">
                    {delegate.status.replace("_", " ")}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Registered {formatDate(delegate.createdAt)}
                  </span>
                </div>

                {/* Lifecycle actions */}
                <div className="flex flex-wrap gap-2">
                  {(delegate.status === "REGISTERED" || delegate.status === "WAITLISTED") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      disabled={isPending}
                      onClick={() =>
                        runAction(
                          () => waitlistDelegate(delegate.id, delegate.status === "REGISTERED"),
                          delegate.status === "REGISTERED" ? "Moved to waitlist." : "Removed from waitlist.",
                        )
                      }
                    >
                      <Clock className="size-3.5" />
                      {delegate.status === "REGISTERED" ? "Waitlist" : "Un-waitlist"}
                    </Button>
                  )}
                  {(delegate.status === "ALLOTTED" || delegate.status === "PAYMENT_SENT") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      disabled={isPending}
                      onClick={() =>
                        runAction(() => regeneratePaymentLink(delegate.id), "Payment link regenerated.")
                      }
                    >
                      <Link2 className="size-3.5" /> Replace pay link
                    </Button>
                  )}
                  {delegate.allotment && delegate.status !== "CONFIRMED" && delegate.status !== "CANCELLED" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      disabled={isPending}
                      onClick={() => runAction(() => compDelegate(delegate.id), "Comped, delegate confirmed.")}
                    >
                      <Gift className="size-3.5" /> Comp
                    </Button>
                  )}
                  {delegate.status !== "CANCELLED" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
                      disabled={isPending}
                      onClick={() => setCancelOpen(true)}
                    >
                      <Ban className="size-3.5" /> Remove from event
                    </Button>
                  )}
                </div>

                <Separator />

                {/* Personal */}
                <Section title="Personal">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Full name" value={delegate.fullName} />
                    <Field label="Email" value={delegate.email} />
                    <Field label="WhatsApp" value={delegate.whatsapp} />
                    <Field label="Alt phone" value={delegate.altPhone} />
                    <Field label="Institution" value={delegate.institution} />
                    <Field label="DTU student" value={delegate.isDtu ? "Yes" : "No"} />
                    {delegate.rollNumber && <Field label="Roll number" value={delegate.rollNumber} />}
                  </div>
                  {delegate.munExperience && (
                    <Field label="MUN experience" value={delegate.munExperience} />
                  )}
                  {delegate.query && <Field label="Their question" value={delegate.query} />}
                </Section>

                <Separator />

                {/* Preferences */}
                <Section title="Preferences">
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label="Pref 1 committee"
                      value={delegate.pref1CommitteeId ? (committeeMap.get(delegate.pref1CommitteeId) ?? delegate.pref1CommitteeId) : null}
                    />
                    <Field label="Pref 1 portfolio" value={delegate.pref1Portfolio} />
                    {!delegate.coDelegate && (
                      <>
                        <Field
                          label="Pref 2 committee"
                          value={delegate.pref2CommitteeId ? (committeeMap.get(delegate.pref2CommitteeId) ?? delegate.pref2CommitteeId) : null}
                        />
                        <Field label="Pref 2 portfolio" value={delegate.pref2Portfolio} />
                      </>
                    )}
                  </div>
                </Section>

                {/* Co-delegate */}
                {delegate.coDelegate && (
                  <>
                    <Separator />
                    <Section title="Co-delegate">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Name" value={delegate.coDelegate.fullName} />
                        <Field label="Email" value={delegate.coDelegate.email} />
                        <Field label="Phone" value={delegate.coDelegate.phone} />
                        <Field label="Institution" value={delegate.coDelegate.institution} />
                      </div>
                      {delegate.coDelegate.munExperience && (
                        <Field label="MUN experience" value={delegate.coDelegate.munExperience} />
                      )}
                    </Section>
                  </>
                )}

                <Separator />

                {/* Accommodation */}
                <Section title="Accommodation">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Needs accommodation" value={delegate.needsAccommodation ? "Yes" : "No"} />
                    <Field label="Outside NCR" value={delegate.outsideNcr ? "Yes" : "No"} />
                  </div>
                </Section>

                {delegate.reference && (
                  <>
                    <Separator />
                    <Section title="Reference">
                      <Field label="How they heard" value={delegate.reference} />
                    </Section>
                  </>
                )}

                <Separator />

                {/* Allotment */}
                <Section title="Allotment">
                  {delegate.allotment ? (
                    <div className="grid grid-cols-2 gap-3">
                      <Field
                        label="Committee"
                        value={committeeMap.get(delegate.allotment.committeeId) ?? delegate.allotment.committeeId}
                      />
                      <Field label="Portfolio" value={delegate.allotment.portfolio?.name ?? delegate.allotment.portfolioId} />
                      <Field
                        label="Allotted at"
                        value={formatDate(delegate.allotment.allottedAt)}
                      />
                      <Field label="Allotted by" value={delegate.allotment.allottedBy} />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not yet allotted.</p>
                  )}
                </Section>

                <Separator />

                {/* Payment */}
                <Section title="Payment">
                  {delegate.payment ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Provider" value={delegate.payment.provider.toUpperCase()} />
                        <Field label="Amount" value={`₹${delegate.payment.amountInr.toLocaleString("en-IN")}`} />
                        <Field label="Status" value={delegate.payment.status} />
                        {delegate.payment.confirmedAt && (
                          <Field
                            label="Confirmed"
                            value={formatDate(delegate.payment.confirmedAt)}
                          />
                        )}
                      </div>
                      {delegate.payment.paymentLink && (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Pay link</p>
                          <a href={delegate.payment.paymentLink} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-xs text-primary hover:underline">
                            {delegate.payment.paymentLink}
                          </a>
                        </div>
                      )}
                      {(delegate.payment.status === "PENDING" ||
                        delegate.payment.status === "SENT" ||
                        delegate.payment.status === "FAILED") && (
                        <Button
                          size="sm"
                          className="w-full gap-1.5"
                          onClick={handleMarkPaid}
                          disabled={isPending}
                        >
                          <CheckCircle className="size-3.5" />
                          {isPending ? "Confirming…" : "Mark as Paid (manual)"}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No payment record yet.</p>
                  )}
                </Section>

                <Separator />

                {/* Follow-up log */}
                <Section title="Follow-up log">
                  {delegate.nextFollowUpAt && new Date(delegate.nextFollowUpAt) <= new Date() && (
                    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                      Follow-up due since {formatDate(delegate.nextFollowUpAt)}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {CONTACT_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => setOutcome(o.value)}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${outcome === o.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
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
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Follow up by
                      <input
                        type="datetime-local"
                        value={followUpLocal}
                        onChange={(e) => setFollowUpLocal(e.target.value)}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                      />
                    </label>
                    <Button size="sm" className="ml-auto h-8 text-xs" disabled={savingContact} onClick={saveContact}>
                      {savingContact ? "Saving" : "Log it"}
                    </Button>
                  </div>
                  {contacts === null ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : contacts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nobody has logged a call or message yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {contacts.map((c) => (
                        <div key={c.id} className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium">{outcomeLabel(c.outcome)}</span>
                            <span className="text-[11px] text-muted-foreground">{formatDate(c.createdAt)}</span>
                          </div>
                          {c.note && <p className="mt-1 whitespace-pre-wrap text-xs">{c.note}</p>}
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {c.createdBy}
                            {c.followUpAt && ` · follow up by ${formatDate(c.followUpAt)}`}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <Separator />

                {/* Email history */}
                <Section title="Email history">
                  {emailLogs === null ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : emailLogs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No emails sent yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {emailLogs.map((log) => (
                        <div key={log.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium">{log.template}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(log.sentAt)}
                              {" · "}
                              <span className={log.status === "FAILED" ? "text-destructive" : "text-green-600"}>
                                {log.status}
                              </span>
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0"
                            title="Resend"
                            disabled={resendingLogId === log.id}
                            onClick={() => {
                              setResendingLogId(log.id)
                              resendEmail(log.id).then((res) => {
                                setResendingLogId(null)
                                if (res.success) {
                                  toast.success("Email resent.")
                                  loadLogs()
                                } else toast.error(res.error ?? "Resend failed.")
                              })
                            }}
                          >
                            <RefreshCw className={`size-3.5 ${resendingLogId === log.id ? "animate-spin" : ""}`} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </div>
            )
          )}
        </div>
      </DrawerContent>
    </Drawer>
    <ConfirmDialog
      open={cancelOpen}
      onOpenChange={setCancelOpen}
      title="Remove from this event?"
      description={delegate ? `${delegate.fullName} is removed from the event and any seat they hold goes back on the board. Unpaid payment links are dropped. A settled payment has to be refunded first.` : ""}
      confirmLabel="Remove from event"
      destructive
      pending={isPending}
      onConfirm={() =>
        delegate && runAction(
          () => cancelDelegate(delegate.id),
          "Removed from the event. Their seat is free again.",
          () => setCancelOpen(false),
        )
      }
    />
    </>
  )
}
