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
  // Loaded per-delegate on open, instead of being joined onto every row of the
  // table behind this drawer.
  const [emailLogs, setEmailLogs] = useState<EmailLogEntry[] | null>(null)

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

  const runAction = (
    fn: () => Promise<{ success: boolean; error?: string; warning?: string; delegate?: SerializedDelegate }>,
    successMsg: string,
  ) => {
    startTransition(async () => {
      const result = await fn()
      if (result.success && result.delegate) {
        if (result.warning) toast.warning(result.warning, { duration: 10000 })
        else toast.success(successMsg)
        onUpdated(result.delegate)
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
    onClose()
  }

  const handleUpdated = (updated: SerializedDelegate) => {
    setEditing(false)
    onUpdated(updated)
  }

  return (
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
                      onClick={() => {
                        if (window.confirm(`Cancel ${delegate.fullName}'s registration? Frees their portfolio.`)) {
                          runAction(() => cancelDelegate(delegate.id), "Registration cancelled.")
                        }
                      }}
                    >
                      <Ban className="size-3.5" /> Cancel
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
                  </div>
                  {delegate.munExperience && (
                    <Field label="MUN experience" value={delegate.munExperience} />
                  )}
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
  )
}
