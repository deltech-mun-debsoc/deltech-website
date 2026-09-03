"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Building2, CalendarRange, Check, LockKeyhole, Megaphone, Rocket, School, WalletCards } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { Content } from "@/content/contentSchema"
import { saveEventControl } from "../actions"

const MODES = [
  { value: "SOCIETY", icon: Building2, title: "Society season", body: "Year-round identity. Events stay quiet until PR starts." },
  { value: "CONFERENCE", icon: CalendarRange, title: "Flagship conference", body: "Bring dates, committees, registration, and payments online." },
  { value: "INTRA_MUN", icon: School, title: "Free Intra MUN", body: "Registration and allotments with no fee or payment email." },
] as const

type PresetKey = "SOCIETY" | "INTRA" | "CONFERENCE_PR" | "CONFERENCE_LIVE" | "CUSTOM"

const PRESETS = [
  { key: "SOCIETY", icon: Building2, title: "Society only", body: "No delegate event is promoted. Recruitment remains independently controlled." },
  { key: "INTRA", icon: School, title: "Free Intra open", body: "Open registration, matrix, and allotments with payment completely disabled." },
  { key: "CONFERENCE_PR", icon: Megaphone, title: "Conference PR", body: "Publish the flagship and committees while keeping delegate forms closed." },
  { key: "CONFERENCE_LIVE", icon: Rocket, title: "Paid registration", body: "Open flagship registration, matrix, allotment, and the payment workflow." },
] as const

function inferPreset(content: Content): PresetKey {
  const s = content.publicSections
  if (
    content.eventMode === "INTRA_MUN" &&
    content.registrationOpen &&
    !content.paymentsEnabled &&
    s.activeEvent && s.registration && s.committees && s.matrix
  ) return "INTRA"
  if (
    content.eventMode === "CONFERENCE" &&
    content.registrationOpen &&
    content.paymentsEnabled &&
    s.activeEvent && s.registration && s.committees && s.matrix
  ) return "CONFERENCE_LIVE"
  if (
    content.eventMode === "CONFERENCE" &&
    !content.registrationOpen &&
    s.activeEvent && !s.registration && s.committees && !s.matrix
  ) return "CONFERENCE_PR"
  if (
    content.eventMode === "SOCIETY" &&
    !content.registrationOpen &&
    !s.activeEvent && !s.registration && !s.committees && !s.matrix
  ) return "SOCIETY"
  return "CUSTOM"
}

const SECTION_ROWS = [
  ["activeEvent", "Active event block", "Show the current event on the society homepage."],
  ["registration", "Registration links", "Expose registration buttons and navigation."],
  ["committees", "Committees", "Show active committees and agendas."],
  ["matrix", "Public matrix", "Expose portfolio availability."],
  ["dispatch", "Dispatch / blog", "Keep society writing visible year-round."],
  ["team", "Society team", "Show the current council and team page."],
  ["quiz", "Live quiz", "Expose the public quiz join link."],
  ["recruitment", "Recruitment", "Show recruitment when the society is hiring."],
] as const

export function EventControl({
  content,
  canManagePayments,
}: {
  content: Content
  canManagePayments: boolean
}) {
  const router = useRouter()
  const [mode, setMode] = useState<Content["eventMode"]>(content.eventMode)
  const [eventName, setEventName] = useState(content.activeEventName)
  const [eventLabel, setEventLabel] = useState(content.activeEventLabel)
  const [eventSubtitle, setEventSubtitle] = useState(content.landingHero.subtitle)
  const [ctaLabel, setCtaLabel] = useState(content.landingHero.ctaLabel)
  const [dates, setDates] = useState(content.conferenceDates)
  const [venue, setVenue] = useState(content.venue)
  const [registrationOpen, setRegistrationOpen] = useState(content.registrationOpen)
  const [paymentsEnabled, setPaymentsEnabled] = useState(content.paymentsEnabled)
  const [sections, setSections] = useState(content.publicSections)
  const [activePreset, setActivePreset] = useState<PresetKey>(() => inferPreset(content))
  const [isPending, startTransition] = useTransition()

  const applyPreset = (preset: Exclude<PresetKey, "CUSTOM">) => {
    setActivePreset(preset)
    if (preset === "SOCIETY") {
      setMode("SOCIETY")
      setRegistrationOpen(false)
      setPaymentsEnabled(false)
      setSections((current) => ({ ...current, activeEvent: false, registration: false, committees: false, matrix: false }))
      return
    }
    if (preset === "INTRA") {
      setMode("INTRA_MUN")
      setRegistrationOpen(true)
      setPaymentsEnabled(false)
      setSections((current) => ({ ...current, activeEvent: true, registration: true, committees: true, matrix: true }))
      return
    }
    if (preset === "CONFERENCE_PR") {
      setMode("CONFERENCE")
      setRegistrationOpen(false)
      setPaymentsEnabled(false)
      setSections((current) => ({ ...current, activeEvent: true, registration: false, committees: true, matrix: false }))
      return
    }
    setMode("CONFERENCE")
    setRegistrationOpen(true)
    setPaymentsEnabled(true)
    setSections((current) => ({ ...current, activeEvent: true, registration: true, committees: true, matrix: true }))
  }

  const chooseMode = (next: Content["eventMode"]) => {
    if (next === "SOCIETY") applyPreset("SOCIETY")
    if (next === "INTRA_MUN") applyPreset("INTRA")
    if (next === "CONFERENCE") applyPreset("CONFERENCE_PR")
  }

  const save = () => startTransition(async () => {
    const result = await saveEventControl({
      eventMode: mode,
      activeEventName: eventName,
      activeEventLabel: eventLabel,
      registrationOpen,
      paymentsEnabled: mode === "CONFERENCE" ? paymentsEnabled : false,
      publicSections: sections,
      conferenceDates: dates,
      venue,
      landingHero: {
        ...content.landingHero,
        subtitle: eventSubtitle,
        ctaLabel,
      },
    })
    if (!result.success) { toast.error(result.error ?? "Could not save event state."); return }
    toast.success("Public site and event workflow updated.")
    router.refresh()
  })

  return <div className="space-y-12">
    <section className="bg-ink p-6 text-paper sm:p-8">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-paper/55">Visitor-facing status</p>
      <div className="mt-5 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <p className="max-w-3xl font-heading text-3xl leading-tight sm:text-4xl">
          {sections.activeEvent ? eventName || "An unnamed event" : "Society website"} is visible.
          {" "}Registration is {registrationOpen ? "open" : "closed"}.
          {" "}Payment is {mode !== "CONFERENCE" || !paymentsEnabled ? "off" : "on"}.
        </p>
        <p className="shrink-0 font-mono text-sm uppercase tracking-wider text-primary-foreground/70">Nothing changes until Apply</p>
      </div>
    </section>

    <section>
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Fast presets</p>
          <h2 className="mt-3 font-heading text-3xl">Choose the delegate workflow</h2>
          <p className="mt-2 text-base text-muted-foreground">Recruitment is independent and is never changed by these presets.</p>
        </div>
        <p className="font-mono text-sm uppercase tracking-wider text-primary" aria-live="polite">
          Draft · {activePreset.replaceAll("_", " ")}
        </p>
      </div>
      <div className="mt-5 grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Delegate workflow preset">
        {PRESETS.map(({ key, icon: Icon, title, body }) => {
          const selected = activePreset === key
          return (
            <button
              key={key}
              type="button"
              aria-pressed={selected}
              disabled={key === "CONFERENCE_LIVE" && !canManagePayments}
              onClick={() => applyPreset(key)}
              className={cn(
                "min-h-52 p-5 text-left transition-colors active:bg-primary active:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-foreground hover:bg-muted",
              )}
            >
              <div className="flex items-start justify-between">
                <Icon className="size-6" />
                {selected && <span className="flex size-7 items-center justify-center rounded-full bg-background text-foreground"><Check className="size-4" /></span>}
              </div>
              <p className="mt-8 text-lg font-bold">{title}</p>
              <p className={cn("mt-2 text-sm", selected ? "text-primary-foreground/75" : "text-muted-foreground")}>{body}</p>
            </button>
          )
        })}
      </div>
    </section>
    <section className="border-t-4 border-foreground pt-6">
      <p className="eyebrow">01 / Operating mode</p>
      <div className="mt-3 flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div><h2 className="font-heading text-3xl">What are we running right now?</h2><p className="mt-2 max-w-2xl text-base text-muted-foreground">This controls the public emphasis and whether allotment creates a payment.</p></div>
        <p className="font-mono text-sm uppercase tracking-wider text-primary">Current · {mode.replace("_", " ")}</p>
      </div>
      <div className="mt-6 grid gap-px overflow-hidden border border-border bg-border lg:grid-cols-3" role="group" aria-label="Event operating mode">
        {MODES.map(({ value, icon: Icon, title, body }) => {
          const selected = mode === value
          return <button
            key={value}
            type="button"
            aria-pressed={selected}
            onClick={() => chooseMode(value)}
            className={cn(
              "relative min-h-48 p-6 text-left transition-colors",
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-background text-foreground hover:bg-muted/60",
            )}
          >
            <div className="flex items-start justify-between"><Icon className="size-7" />{selected && <span className="flex size-7 items-center justify-center rounded-full bg-background text-foreground"><Check className="size-4" /></span>}</div>
            <h3 className="mt-10 font-heading text-2xl">{title}</h3><p className={cn("mt-2 text-sm leading-relaxed", selected ? "text-primary-foreground/75" : "text-muted-foreground")}>{body}</p>
          </button>
        })}
      </div>
    </section>

    <section className="grid gap-10 border-t-4 border-foreground pt-6 xl:grid-cols-[0.9fr_1.1fr]">
      <div>
        <p className="eyebrow">02 / Active event</p><h2 className="mt-3 font-heading text-3xl">Public event signal</h2>
        <p className="mt-2 max-w-lg text-base leading-relaxed text-muted-foreground">Everything visitors need to understand the active event, in one place.</p>
        <div className="mt-7 space-y-5">
          <div className="space-y-2"><Label htmlFor="event-name">Event name</Label><Input id="event-name" value={eventName} onChange={(e) => setEventName(e.target.value)} className="h-12 text-base" placeholder="DelTech MUN 2027" /></div>
          <div className="space-y-2"><Label htmlFor="event-label">Short context</Label><Input id="event-label" value={eventLabel} onChange={(e) => setEventLabel(e.target.value)} className="h-12 text-base" placeholder="Flagship conference · January 2027" /></div>
          <div className="space-y-2"><Label htmlFor="event-subtitle">What is this event?</Label><Input id="event-subtitle" value={eventSubtitle} onChange={(e) => setEventSubtitle(e.target.value)} className="h-12 text-base" placeholder="A clear one-sentence brief for delegates." /></div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="event-dates">Dates</Label><Input id="event-dates" value={dates} onChange={(e) => setDates(e.target.value)} className="h-12 text-base" placeholder="10–11 January 2027" /></div>
            <div className="space-y-2"><Label htmlFor="event-venue">Venue</Label><Input id="event-venue" value={venue} onChange={(e) => setVenue(e.target.value)} className="h-12 text-base" placeholder="DTU, Delhi" /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="event-cta">Registration button</Label><Input id="event-cta" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} className="h-12 text-base" placeholder="Apply as a delegate" /></div>
        </div>
      </div>
      <div className="bg-ink p-7 text-paper">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-paper/60">Homepage preview</p>
        <p className="mt-8 max-w-[12ch] font-heading text-4xl leading-tight">{eventName || "No active event named"}</p>
        <p className="mt-3 font-mono text-xs uppercase tracking-wider text-gold-300">{eventLabel || "Event context will appear here"}</p>
        <p className="mt-4 text-base text-paper/65">{eventSubtitle || "Add one useful sentence explaining the event."}</p>
        <p className="mt-7 text-sm text-paper/60">{dates || "Dates pending"} · {venue || "Venue pending"}</p>
        <div className="mt-10 flex flex-wrap gap-5 border-t border-paper/20 pt-5 font-mono text-xs uppercase tracking-wider"><span>{sections.activeEvent ? "Visible" : "Hidden"}</span><span>{registrationOpen ? "Registration open" : "Registration closed"}</span><span>{mode !== "CONFERENCE" ? "Free" : paymentsEnabled ? "Paid" : "No payment"}</span></div>
      </div>
    </section>

    <section className="border-t-4 border-foreground pt-6">
      <p className="eyebrow">03 / Public switches</p><h2 className="mt-3 font-heading text-3xl">Publish only what is ready</h2>
      <div className="mt-6 divide-y divide-border border-y border-border">
        {SECTION_ROWS.map(([key, title, body]) => <div key={key} className="grid gap-4 py-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div><p className="text-base font-semibold">{title}</p><p className="mt-1 text-sm text-muted-foreground">{body}</p></div>
          <Switch checked={sections[key]} onCheckedChange={(checked) => {
            setActivePreset("CUSTOM")
            setSections((current) => ({ ...current, [key]: checked }))
          }} className="scale-125" />
        </div>)}
      </div>
    </section>

    <section className="grid gap-px overflow-hidden border border-border bg-border lg:grid-cols-2">
      <div className="flex items-center justify-between gap-5 bg-background p-6"><div><p className="font-semibold">Accept registrations</p><p className="mt-1 text-sm text-muted-foreground">Controls whether the form accepts submissions.</p></div><Switch checked={registrationOpen} onCheckedChange={(checked) => { setActivePreset("CUSTOM"); setRegistrationOpen(checked) }} className="scale-125" /></div>
      <div className="flex items-center justify-between gap-5 bg-background p-6">
        <div className="flex gap-3">
          <WalletCards className="mt-0.5 size-5" />
          <div>
            <p className="font-semibold">Collect payment after allotment</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode !== "CONFERENCE"
                ? "Only a flagship conference can collect delegate fees."
                : canManagePayments
                  ? "Turn on only when the payment workflow is ready."
                  : "Admin-only. Your other event changes can still be published."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!canManagePayments && <LockKeyhole className="size-4 text-muted-foreground" aria-label="Admin only" />}
          <Switch
            checked={mode === "CONFERENCE" ? paymentsEnabled : false}
            onCheckedChange={(checked) => { setActivePreset("CUSTOM"); setPaymentsEnabled(checked) }}
            disabled={mode !== "CONFERENCE" || !canManagePayments}
            className="scale-125"
          />
        </div>
      </div>
    </section>

    <div className="sticky bottom-5 z-20 flex items-center justify-between border border-border bg-background/95 p-4 shadow-xl backdrop-blur"><p className="hidden text-sm text-muted-foreground sm:block">Apply publishes the new state immediately and clears the public-page cache.</p><Button size="lg" onClick={save} disabled={isPending} className="ml-auto min-w-44">{isPending ? "Publishing…" : "Apply and publish"}</Button></div>
  </div>
}
