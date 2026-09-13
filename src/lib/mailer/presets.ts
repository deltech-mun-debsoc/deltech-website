// Starting drafts for the mails the secretariat sends every event. Each fills in
// what it can from the event settings and is then edited freely: a preset is a
// head start, never a locked template.

export interface PresetContext {
  eventName: string
  dates: string
  venue: string
  registerUrl: string
  whatsappUrl: string
  secretariatEmail: string
  paymentDeadline: string
  daysToGo: number | null
}

export interface PresetDraft {
  subject: string
  body: string
  ctaLabel?: string
  ctaUrl?: string
}

export interface MailPreset {
  key: string
  label: string
  audience: "DELEGATES" | "CONTACTS" | "ANY"
  description: string
  build: (ctx: PresetContext) => PresetDraft
}

const or = (value: string, fallback: string) => (value.trim() ? value.trim() : fallback)

export const MAIL_PRESETS: MailPreset[] = [
  {
    key: "custom",
    label: "Blank",
    audience: "ANY",
    description: "Start from nothing.",
    build: () => ({ subject: "", body: "Hi {firstName},\n\n" }),
  },
  {
    key: "announcement",
    label: "Announcement",
    audience: "ANY",
    description: "A short update with one link.",
    build: (c) => ({
      subject: `An update from ${c.eventName}`,
      body: `Hi {firstName},\n\nWrite the update here.\n\nThe ${c.eventName} Secretariat`,
    }),
  },
  {
    key: "registration-open",
    label: "Registrations open",
    audience: "ANY",
    description: "PR: tell the list they can apply.",
    build: (c) => ({
      subject: `Registrations are open for ${c.eventName}`,
      body:
        `Hi {firstName},\n\nRegistrations for ${c.eventName} are now open.\n\n` +
        `${or(c.dates, "Dates to be announced")} at ${or(c.venue, "a venue to be announced")}.\n\n` +
        `Seats in each committee are allotted as applications come in, so earlier applicants get more choice.`,
      ctaLabel: "Register now",
      ctaUrl: c.registerUrl,
    }),
  },
  {
    key: "conference-details",
    label: "Conference details",
    audience: "ANY",
    description: "Dates, venue and how to take part.",
    build: (c) => ({
      subject: `${c.eventName}: dates, venue and what to expect`,
      body:
        `Hi {firstName},\n\nHere is everything you need to know about ${c.eventName}.\n\n` +
        `Dates: ${or(c.dates, "to be announced")}\nVenue: ${or(c.venue, "to be announced")}\n\n` +
        `Questions go to ${c.secretariatEmail}.`,
      ctaLabel: "See the conference",
      ctaUrl: c.registerUrl,
    }),
  },
  {
    key: "countdown",
    label: "Countdown",
    audience: "ANY",
    description: "A reminder as the conference gets close.",
    build: (c) => ({
      subject:
        c.daysToGo !== null && c.daysToGo > 0
          ? `${c.daysToGo} ${c.daysToGo === 1 ? "day" : "days"} to ${c.eventName}`
          : `${c.eventName} is almost here`,
      body:
        `Hi {firstName},\n\n${c.eventName} is almost here: ${or(c.dates, "dates to be announced")} at ${or(c.venue, "the venue")}.\n\n` +
        `Write what people should do before then.`,
    }),
  },
  {
    key: "pre-conference-brief",
    label: "Pre-conference brief",
    audience: "DELEGATES",
    description: "Where to be, what to bring, their seat.",
    build: (c) => ({
      subject: `Your brief for ${c.eventName}`,
      body:
        `Hi {firstName},\n\nYou are {portfolio} in {committee}.\n\n` +
        `Dates: ${or(c.dates, "to be announced")}\nVenue: ${or(c.venue, "to be announced")}\n\n` +
        `Bring a photo ID and your check-in code, which is on your delegate page.\n\n` +
        (c.whatsappUrl ? `Last-minute changes go out on the delegates group: {whatsapp}\n\n` : "") +
        `See you there.`,
      ctaLabel: "Open my delegate page",
      ctaUrl: "{statusLink}",
    }),
  },
  {
    key: "payment-nudge",
    label: "Payment reminder",
    audience: "DELEGATES",
    description: "For allotted delegates who have not paid.",
    build: (c) => ({
      subject: `Your seat at ${c.eventName} is waiting on payment`,
      body:
        `Hi {firstName},\n\nYou have been allotted {portfolio} in {committee}, and the payment is still outstanding.\n\n` +
        (c.paymentDeadline ? `Please pay by ${c.paymentDeadline} to keep the seat.\n\n` : "") +
        `Everything you need is on your delegate page.`,
      ctaLabel: "Pay from my delegate page",
      ctaUrl: "{statusLink}",
    }),
  },
  {
    key: "post-event",
    label: "Thank you",
    audience: "DELEGATES",
    description: "After the conference.",
    build: (c) => ({
      subject: `Thank you for coming to ${c.eventName}`,
      body: `Hi {firstName},\n\nThank you for being part of ${c.eventName}.\n\nWrite what comes next here.`,
    }),
  },
]

export function presetFor(key: string): MailPreset {
  return MAIL_PRESETS.find((p) => p.key === key) ?? MAIL_PRESETS[0]
}
