"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronDown, LockKeyhole } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { saveEventSettings, type EventSettingsInput } from "../actions"

export type EventSettingsValues = Required<EventSettingsInput>

const KINDS = [
  { value: "INTRA_MUN", title: "Intra MUN", hint: "DTU only · roll number, no accommodation" },
  { value: "CONFERENCE", title: "Conference", hint: "Any college · institution and accommodation" },
] as const

function Toggle({
  id,
  title,
  body,
  checked,
  onChange,
  disabled,
  locked,
}: {
  id: string
  title: string
  body: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  locked?: boolean
}) {
  return (
    <div className={cn("flex items-center justify-between gap-6 py-3.5", disabled && "opacity-55")}>
      <div>
        <Label htmlFor={id} className="text-sm font-medium">{title}</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {locked && <LockKeyhole className="size-4 text-muted-foreground" aria-label="Admin only" />}
        <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled || locked} />
      </div>
    </div>
  )
}

// Everything about the running event, in one form with one save. The website
// follows these settings directly (src/lib/event-overlay.ts), so what is shown
// here is what visitors get.
export function EventSettings({
  initial,
  readiness,
  canManagePayments,
}: {
  initial: EventSettingsValues
  readiness: { committees: number; seats: number }
  canManagePayments: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [v, setV] = useState(initial)
  const set = <K extends keyof EventSettingsValues>(key: K, value: EventSettingsValues[K]) =>
    setV((current) => ({ ...current, [key]: value }))
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)
  const intra = v.kind === "INTRA_MUN"

  const save = () =>
    startTransition(async () => {
      const result = await saveEventSettings(v)
      if (!result.success) {
        toast.error(result.error ?? "Could not save the event settings.")
        return
      }
      toast.success(v.published ? "Saved. The website shows the changes now." : "Saved. The event stays hidden until you publish it.")
      router.refresh()
    })

  const missing = [
    !(v.name.trim() && v.dates.trim() && v.venue.trim()) && { label: "Name, dates and venue", href: "#event-details" },
    readiness.committees === 0 && { label: "Committees", href: "/admin/config/committees" },
    readiness.seats === 0 && { label: "Matrix seats", href: "/admin/config/committees" },
  ].filter((m): m is { label: string; href: string } => !!m)

  const status = [
    { on: v.published, label: v.published ? "Live" : "Hidden" },
    { on: v.published && v.registrationOpen, label: v.registrationOpen ? "Registration open" : "Registration closed" },
    { on: v.published && v.matrixPublic, label: v.matrixPublic ? "Matrix public" : "Matrix hidden" },
    { on: v.paymentsEnabled, label: v.paymentsEnabled ? "Paid" : "Free" },
  ]

  return (
    <div className="space-y-8 pb-24">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {status.map((item) => (
          <span
            key={item.label}
            className={cn(
              "rounded-full border px-2.5 py-1",
              item.on ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground",
            )}
          >
            {item.label}
          </span>
        ))}
        {missing.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
          >
            {`Missing: ${item.label}`}
          </Link>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Event type</h2>
        <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Event type">
          {KINDS.map((kind) => (
            <button
              key={kind.value}
              type="button"
              role="radio"
              aria-checked={v.kind === kind.value}
              onClick={() => set("kind", kind.value)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                v.kind === kind.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {kind.title}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{KINDS.find((k) => k.value === v.kind)?.hint}</p>
      </section>

      <section id="event-website" className="scroll-mt-24">
        <h2 className="text-sm font-semibold">Website</h2>
        <div className="mt-1 divide-y divide-border border-y border-border">
          <Toggle
            id="event-published"
            title="Published"
            body="Homepage, committees and the register button."
            checked={v.published}
            onChange={(next) => set("published", next)}
          />
          <Toggle
            id="event-registration"
            title="Registration open"
            body={v.published ? "The form accepts new delegates." : "Publish first."}
            checked={v.registrationOpen}
            onChange={(next) => set("registrationOpen", next)}
            disabled={!v.published}
          />
          <Toggle
            id="event-matrix"
            title="Matrix public"
            body={v.published ? "Open seats are visible and can be picked at registration." : "Publish first."}
            checked={v.matrixPublic}
            onChange={(next) => set("matrixPublic", next)}
            disabled={!v.published}
          />
          <Toggle
            id="event-payments"
            title="Payment after allotment"
            body={canManagePayments ? "On: allotment sends a pay link. Off: allotment confirms straight away." : "Admin only."}
            checked={v.paymentsEnabled}
            onChange={(next) => set("paymentsEnabled", next)}
            locked={!canManagePayments}
          />
        </div>
      </section>

      <section id="event-details" className="scroll-mt-24 space-y-4">
        <h2 className="text-sm font-semibold">Details</h2>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="event-name">Event name</Label>
            <Input id="event-name" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="DTU Intra MUN 2026" className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-label">Short label <span className="text-xs font-normal text-muted-foreground">optional</span></Label>
            <Input id="event-label" value={v.label} onChange={(e) => set("label", e.target.value)} placeholder={intra ? "Intra MUN · October 2026" : "Flagship conference · January 2027"} className="h-11" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="event-brief">One-line brief <span className="text-xs font-normal text-muted-foreground">optional</span></Label>
            <Input id="event-brief" value={v.brief} onChange={(e) => set("brief", e.target.value)} placeholder="A day of committees for DTU students, first-timers welcome." className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-dates">Dates</Label>
            <Input id="event-dates" value={v.dates} onChange={(e) => set("dates", e.target.value)} placeholder="10 October 2026" className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-venue">Venue</Label>
            <Input id="event-venue" value={v.venue} onChange={(e) => set("venue", e.target.value)} placeholder="Delhi Technological University" className="h-11" />
          </div>
        </div>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            Button text, external form, closed message
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="event-cta">Register button text</Label>
            <Input id="event-cta" value={v.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} placeholder="Register now" className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-form-url">External registration form <span className="text-xs font-normal text-muted-foreground">optional</span></Label>
            <Input id="event-form-url" value={v.formUrl} onChange={(e) => set("formUrl", e.target.value)} placeholder="https://docs.google.com/forms/d/..." className="h-11" />
            <p className="text-xs text-muted-foreground">
              {intra ? "Leave empty to use the website's form. A Google Form link sends every Register button there instead." : "Only used for an Intra MUN."}
            </p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="event-closed-message">Message while registration is closed</Label>
            <Input id="event-closed-message" value={v.closedMessage} onChange={(e) => set("closedMessage", e.target.value)} placeholder="Registrations are currently closed. Check back soon." className="h-11" />
          </div>
          </div>
        </details>
      </section>

      <div className="sticky bottom-5 z-20 flex items-center justify-between gap-4 border border-border bg-background/95 p-4 shadow-xl backdrop-blur">
        <p className="text-sm text-muted-foreground">{dirty ? "You have unsaved changes." : "Everything is saved."}</p>
        <Button size="lg" onClick={save} disabled={pending || !dirty} className="min-w-40">
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}
