"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowRight, Check, ChevronDown, Circle, LockKeyhole } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { saveEventSettings, type EventSettingsInput } from "../actions"

export type EventSettingsValues = Required<EventSettingsInput>

const KINDS = [
  {
    value: "INTRA_MUN",
    title: "Intra MUN",
    body: "For DTU students. Registration asks for a roll number instead of a college, and skips accommodation.",
  },
  {
    value: "CONFERENCE",
    title: "Conference",
    body: "Open to every college. Registration asks for the institution and accommodation.",
  },
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
    <div className={cn("flex items-center justify-between gap-6 py-5", disabled && "opacity-55")}>
      <div>
        <Label htmlFor={id} className="text-base font-semibold">{title}</Label>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
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

  const checklist = [
    { done: !!(v.name.trim() && v.dates.trim() && v.venue.trim()), label: "Name, dates and venue", href: "#event-details" },
    { done: readiness.committees > 0, label: `Committees (${readiness.committees})`, href: "/admin/config/committees" },
    { done: readiness.seats > 0, label: `Seats in the matrix (${readiness.seats})`, href: "/admin/config/committees" },
    { done: v.published, label: "Published on the website", href: "#event-website" },
    { done: v.published && v.registrationOpen, label: "Registration open", href: "#event-website" },
  ]

  const summary = v.published
    ? `Visitors see ${v.name.trim() || "this event"} on the homepage. Registration is ${v.registrationOpen ? "open" : "closed"}, the matrix is ${v.matrixPublic ? "public" : "hidden"}, and it is ${v.paymentsEnabled ? "paid" : "free"}.`
    : "Hidden from visitors while you set it up. Staff can build committees, the matrix and delegates meanwhile."

  return (
    <div className="space-y-10 pb-24">
      <section className="grid gap-px overflow-hidden border border-border bg-border lg:grid-cols-[1.2fr_0.8fr]">
        <div className="bg-ink p-6 text-paper sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-paper/55">{v.published ? "Live on the website" : "Not published yet"}</p>
          <p className="mt-4 max-w-2xl font-heading text-2xl leading-snug sm:text-3xl">{summary}</p>
        </div>
        <div className="bg-background p-6 sm:p-8">
          <p className="eyebrow">Ready to run</p>
          <ul className="mt-4 space-y-2.5">
            {checklist.map((item) => (
              <li key={item.label}>
                <Link href={item.href} className="group flex items-center gap-2.5 text-sm">
                  {item.done ? <Check className="size-4 text-primary" /> : <Circle className="size-4 text-muted-foreground" />}
                  <span className={cn(item.done ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>{item.label}</span>
                  {!item.done && <ArrowRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="eyebrow">What kind of event</p>
          <h2 className="mt-2 font-heading text-2xl">Who is it for?</h2>
        </div>
        <div className="grid gap-px overflow-hidden border border-border bg-border md:grid-cols-2" role="radiogroup" aria-label="Kind of event">
          {KINDS.map((kind) => {
            const selected = v.kind === kind.value
            return (
              <button
                key={kind.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => set("kind", kind.value)}
                className={cn(
                  "p-5 text-left transition-colors",
                  selected ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                )}
              >
                <div className="flex items-center justify-between">
                  <p className="text-lg font-bold">{kind.title}</p>
                  {selected && <Check className="size-5" />}
                </div>
                <p className={cn("mt-2 text-sm", selected ? "text-primary-foreground/80" : "text-muted-foreground")}>{kind.body}</p>
              </button>
            )
          })}
        </div>
      </section>

      <section id="event-website" className="scroll-mt-24">
        <p className="eyebrow">On the website</p>
        <h2 className="mt-2 font-heading text-2xl">What visitors can do</h2>
        <div className="mt-2 divide-y divide-border border-y border-border">
          <Toggle
            id="event-published"
            title="Publish this event"
            body="Shows the event on the homepage, with its committees and a registration link."
            checked={v.published}
            onChange={(next) => set("published", next)}
          />
          <Toggle
            id="event-registration"
            title="Accept registrations"
            body={v.published ? "The registration form takes new delegates." : "Publish the event first."}
            checked={v.registrationOpen}
            onChange={(next) => set("registrationOpen", next)}
            disabled={!v.published}
          />
          <Toggle
            id="event-matrix"
            title="Show the portfolio matrix"
            body={v.published ? "Visitors see which seats are still available, and can pick one when they register." : "Publish the event first."}
            checked={v.matrixPublic}
            onChange={(next) => set("matrixPublic", next)}
            disabled={!v.published}
          />
          <Toggle
            id="event-payments"
            title="Collect payment after allotment"
            body={
              !canManagePayments
                ? "Only an admin can change this."
                : intra
                  ? "Intra MUNs are normally free. When off, allotting a seat confirms the delegate straight away."
                  : "When on, allotting a seat sends a payment link and the delegate is confirmed once they pay."
            }
            checked={v.paymentsEnabled}
            onChange={(next) => set("paymentsEnabled", next)}
            locked={!canManagePayments}
          />
        </div>
      </section>

      <section id="event-details" className="scroll-mt-24 space-y-5">
        <div>
          <p className="eyebrow">Details</p>
          <h2 className="mt-2 font-heading text-2xl">How the event is described</h2>
        </div>
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
            More options: button text, external form, closed message
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
