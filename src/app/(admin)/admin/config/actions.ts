"use server"

import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { setContent, getContent } from "@/lib/settings"
import { syncSheetCell } from "@/lib/sheet-sync"
import { requireStaff, requireAdmin } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { callAI, AIRateLimitError } from "@/lib/ai"
import { revalidatePath } from "next/cache"
import { ContentSchema, type Content } from "@/content/contentSchema"
import { pickValues, reversibleSettingsMeta } from "@/lib/audit-change"

// Money/sync config only an ADMIN may touch, kept out of saveContent entirely.
const PAYMENT_KEYS = new Set([
  "paymentProvider", "staticPaymentLink", "upiVpa", "upiPayeeName", "paymentDeadline",
  "paymentProofUrl", "refundPolicy", "whatsappCommunityUrl", "secretariatEmail", "sheetSyncUrl",
])

function publishContentChanges() {
  revalidatePath("/", "layout")
  revalidatePath("/")
  revalidatePath("/availability")
  revalidatePath("/register")
  revalidatePath("/team")
  revalidatePath("/blog")
}

// ── Content ────────────────────────────────────────────────────────────────────
export async function saveContent(
  partial: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  if (Object.keys(partial).some((k) => PAYMENT_KEYS.has(k))) {
    return { success: false, error: "Payment settings must be saved via the payment card (admin only)." }
  }
  try {
    const before = await getContent()
    await setContent(partial)
    const keys = Object.keys(partial)
    await audit(
      session.user?.email ?? "unknown",
      "content.save",
      "Setting",
      "site-content",
      reversibleSettingsMeta({
        summary: "Updated public site content.",
        before: pickValues(before, keys),
        after: partial,
      }),
    )
    publishContentChanges()
    return { success: true }
  } catch {
    return { success: false, error: "Failed to save." }
  }
}

// Replay every allotted cell's current state to the public Google Sheet.
// syncSheetCell is best-effort per cell (fire-and-forget, self-heals on next
// state change), so a mirror that's down for a while silently drifts, this
// is the manual "reconcile now" for when it comes back.
// ponytail: sequential to avoid hammering the single Apps Script endpoint;
// parallelize in chunks only if a very large room makes this too slow.
export async function resyncMatrix(): Promise<{ success: boolean; synced?: number; error?: string }> {
  const session = await requireStaff()
  const content = await getContent()
  if (!content.sheetSyncUrl) {
    return { success: false, error: "No sheet sync URL configured (set it under Config → Money)." }
  }

  const allotted = await prisma.portfolio.findMany({
    where: { status: "ALLOTTED", allotment: { isNot: null } },
    select: {
      name: true,
      committee: { select: { name: true } },
      allotment: { select: { delegate: { select: { status: true } } } },
    },
  })

  for (const p of allotted) {
    if (!p.allotment) continue
    await syncSheetCell({
      committee: p.committee.name,
      portfolio: p.name,
      state: p.allotment.delegate.status === "CONFIRMED" ? "paid" : "allotted",
    })
  }

  await audit(session.user?.email ?? "unknown", "matrix.resync", "Setting", undefined, {
    synced: allotted.length,
  })
  return { success: true, synced: allotted.length }
}

const EventControlSchema = ContentSchema.pick({
  eventMode: true,
  activeEventName: true,
  activeEventLabel: true,
  registrationOpen: true,
  registrationFormUrl: true,
  paymentsEnabled: true,
  publicSections: true,
  conferenceDates: true,
  venue: true,
  landingHero: true,
})

type EventControlInput = Pick<
  Content,
  | "eventMode"
  | "activeEventName"
  | "activeEventLabel"
  | "registrationOpen"
  | "registrationFormUrl"
  | "paymentsEnabled"
  | "publicSections"
  | "conferenceDates"
  | "venue"
  | "landingHero"
>

export async function saveEventControl(
  input: EventControlInput,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  const parsed = EventControlSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: "Review the event settings and try again." }

  const { paymentsEnabled, ...eventState } = parsed.data
  const role = (session.user as { role?: string }).role
  const before = await getContent()
  const sections = {
    ...eventState.publicSections,
    registration:
      eventState.registrationOpen || eventState.publicSections.registration,
    activeEvent:
      eventState.eventMode === "SOCIETY"
        ? false
        : eventState.publicSections.activeEvent,
  }
  if (sections.activeEvent && !eventState.activeEventName.trim()) {
    return { success: false, error: "Name the active event before publishing it." }
  }
  const formUrl = eventState.registrationFormUrl.trim()
  if (formUrl && !/^https:\/\/\S+$/.test(formUrl)) {
    return { success: false, error: "The registration form link must start with https://. Copy it from your browser." }
  }
  const partial: Record<string, unknown> = {
    ...eventState,
    activeEventName: eventState.activeEventName.trim(),
    activeEventLabel: eventState.activeEventLabel.trim(),
    conferenceDates: eventState.conferenceDates.trim(),
    venue: eventState.venue.trim(),
    registrationFormUrl: formUrl,
    publicSections: sections,
    registrationOpen:
      eventState.eventMode === "SOCIETY" ? false : eventState.registrationOpen,
    matrixPublic: sections.matrix,
  }

  // Intra MUNs are always free. Outside Intra mode, only an admin may change
  // the payment switch; maintainers can still publish every other event state.
  if (eventState.eventMode !== "CONFERENCE" || !paymentsEnabled) {
    partial.paymentsEnabled = false
  } else if (role === "ADMIN") {
    partial.paymentsEnabled = true
  }

  try {
    await setContent(partial)
    const keys = Object.keys(partial)
    await audit(
      session.user?.email ?? "unknown",
      "eventControl.save",
      "Setting",
      "event-control",
      reversibleSettingsMeta({
        summary: `Published ${eventState.eventMode.toLowerCase().replace("_", " ")} mode.`,
        before: pickValues(before, keys),
        after: partial,
      }),
    )
    publishContentChanges()
    return { success: true }
  } catch {
    return { success: false, error: "Could not publish the event state." }
  }
}

export async function savePaymentConfig(partial: {
  paymentsEnabled?: boolean
  paymentProvider?: "upi_qr" | "razorpay" | "static_link"
  staticPaymentLink?: string
  upiVpa?: string
  upiPayeeName?: string
  paymentDeadline?: string
  paymentProofUrl?: string
  refundPolicy?: string
  whatsappCommunityUrl?: string
  secretariatEmail?: string
  sheetSyncUrl?: string
}): Promise<{ success: boolean; error?: string }> {
  const session = await requireAdmin()
  try {
    const before = await getContent()
    await setContent(partial)
    const keys = Object.keys(partial)
    await audit(
      session.user?.email ?? "unknown",
      "content.savePaymentConfig",
      "Setting",
      "payment-config",
      reversibleSettingsMeta({
        summary: "Updated payment and integration settings.",
        before: pickValues(before, keys),
        after: partial,
      }),
    )
    publishContentChanges()
    return { success: true }
  } catch {
    return { success: false, error: "Failed to save." }
  }
}

// ── Registration toggle ────────────────────────────────────────────────────────
export async function setRegistrationOpen(
  open: boolean,
): Promise<{ success: boolean }> {
  const session = await requireStaff()
  const content = await getContent()
  await setContent({ registrationOpen: open })
  await audit(
    session.user?.email ?? "unknown",
    open ? "registration.open" : "registration.close",
    "Setting",
    "registration",
    reversibleSettingsMeta({
      summary: open ? "Opened delegate registration." : "Closed delegate registration.",
      before: { registrationOpen: content.registrationOpen },
      after: { registrationOpen: open },
    }),
  )
  publishContentChanges()
  return { success: true }
}

// ── Committees ─────────────────────────────────────────────────────────────────
export async function createCommittee(data: {
  name: string
  slug: string
  agenda?: string
  type: "STANDARD" | "CRISIS" | "PRESS"
  doubleDelegation: boolean
  sortOrder: number
  aliases?: string[]
  portfolioTagLabel?: string
  matrixBrief?: string
}): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  try {
    const committee = await prisma.committee.create({ data })
    await audit(session.user?.email ?? "unknown", "committee.create", "Committee", committee.id, {
      name: data.name,
    })
    return { success: true }
  } catch {
    return { success: false, error: "Failed. Slug may already exist." }
  }
}

export async function updateCommittee(
  id: string,
  data: {
    name: string
    slug: string
    agenda?: string
    type: "STANDARD" | "CRISIS" | "PRESS"
    doubleDelegation: boolean
    isActive: boolean
    sortOrder: number
    aliases?: string[]
    portfolioTagLabel?: string
    matrixBrief?: string
  },
): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  try {
    await prisma.committee.update({ where: { id }, data })
    await audit(session.user?.email ?? "unknown", "committee.update", "Committee", id)
    return { success: true }
  } catch {
    return { success: false, error: "Failed to update committee." }
  }
}

export async function deleteCommittee(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireAdmin()
  try {
    await prisma.committee.delete({ where: { id } })
    await audit(session.user?.email ?? "unknown", "committee.delete", "Committee", id)
    return { success: true }
  } catch {
    return { success: false, error: "Cannot delete, committee has linked data." }
  }
}

// ── Portfolios ─────────────────────────────────────────────────────────────────
export async function addPortfolio(
  committeeId: string,
  name: string,
  tag?: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  const trimmed = name.trim()
  if (!trimmed) return { success: false, error: "Name is required." }
  try {
    await prisma.portfolio.create({ data: { committeeId, name: trimmed, tag: tag?.trim() || null } })
    await audit(session.user?.email ?? "unknown", "portfolio.add", "Portfolio", undefined, {
      committeeId,
      name: trimmed,
    })
    return { success: true }
  } catch {
    return { success: false, error: "Portfolio already exists in this committee." }
  }
}

export async function bulkAddPortfolios(
  committeeId: string,
  entries: Array<{ name: string; tag?: string; priority?: number }>,
): Promise<{ success: boolean; added: number; skipped: number }> {
  const session = await requireStaff()
  let added = 0
  let skipped = 0
  for (const entry of entries) {
    const name = entry.name.trim()
    if (!name) continue
    try {
      await prisma.portfolio.create({
        data: {
          committeeId,
          name,
          tag: entry.tag?.trim() || null,
          priority: Math.max(0, Math.min(entry.priority ?? 0, 999)),
        },
      })
      added++
    } catch {
      skipped++
    }
  }
  await audit(session.user?.email ?? "unknown", "portfolio.bulkAdd", "Portfolio", undefined, {
    committeeId,
    added,
    skipped,
  })
  return { success: true, added, skipped }
}

export async function updatePortfolio(
  id: string,
  data: { name: string; tag?: string; priority?: number },
): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  const name = data.name.trim()
  if (!name) return { success: false, error: "Name is required." }
  try {
    await prisma.portfolio.update({
      where: { id },
      data: {
        name,
        tag: data.tag?.trim() || null,
        priority: Math.max(0, Math.min(data.priority ?? 0, 999)),
      },
    })
    await audit(session.user?.email ?? "unknown", "portfolio.update", "Portfolio", id)
    return { success: true }
  } catch {
    return { success: false, error: "Could not update this portfolio." }
  }
}

export async function deletePortfolio(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireAdmin()
  try {
    await prisma.portfolio.delete({ where: { id } })
    await audit(session.user?.email ?? "unknown", "portfolio.delete", "Portfolio", id)
    return { success: true }
  } catch {
    return { success: false, error: "Cannot delete, portfolio has an allotment." }
  }
}

// ── AI matrix generation ───────────────────────────────────────────────────────
// Every committee is agenda-sensitive. Even a GA matrix should be ranked by
// relevance, not sliced alphabetically from a static country list.
const portfolioListSchema = z.object({
  tagLabel: z.string().max(40).optional(),
  sourceNote: z.string().max(240).optional(),
  portfolios: z.array(z.object({
    name: z.string().min(2).max(100),
    tag: z.string().max(50).optional().default(""),
    priority: z.number().int().min(1).max(300),
  })).min(1).max(300),
})

export async function generatePortfolios(
  committeeId: string,
  size: number,
  brief?: string,
): Promise<{
  success: boolean
  portfolios?: Array<{ name: string; tag: string; priority: number }>
  tagLabel?: string
  sourceNote?: string
  error?: string
  rateLimited?: boolean
}> {
  await requireStaff()
  const committee = await prisma.committee.findUnique({
    where: { id: committeeId },
    select: { name: true, agenda: true, type: true, aliases: true, matrixBrief: true },
  })
  if (!committee) return { success: false, error: "Committee not found." }
  const count = Math.min(Math.max(size, 1), 300)

  const today = new Date().toISOString().slice(0, 10)
  const normalizedName = `${committee.name} ${committee.aliases.join(" ")}`.toLowerCase()
  const isIndianParliament = /aippm|all india political parties|lok sabha|rajya sabha|parliament/.test(normalizedName)
  const isHrc = /unhrc|human rights council/.test(normalizedName)
  const isSc = /unsc|security council/.test(normalizedName)
  const explicitBrief = brief?.trim() || committee.matrixBrief?.trim() || "No additional scenario brief supplied."

  const committeeRules = isIndianParliament
    ? `This is an Indian political committee. Return CURRENT politicians or office-holders only. Never return reporters, journalists, news outlets, generic positions, or fictional people. Tag every person with their current political party (or Independent). Prioritize decision-makers and actors relevant to the agenda across government and opposition.`
    : isHrc
      ? `Tag every country exactly as Member, Non-member, or Observer. Prioritize current Human Rights Council members, then agenda-critical non-members and observers. Membership changes over time, so use the date and scenario brief and do not claim certainty in sourceNote.`
      : isSc
        ? `Tag countries as Permanent, Elected, or Invited/Observer. Include the current P5 and current elected members first, then only agenda-critical invited parties.`
        : committee.type === "PRESS"
          ? `This is the ONLY type where press roles are valid. Return specific roles such as Reporter · Reuters or Photojournalist · AP and tag each with Desk or Outlet.`
          : committee.type === "CRISIS"
            ? `Return real characters or offices that belong in this cabinet/crisis. Tag each by faction, institution, or side.`
            : `Return countries ordered by agenda relevance and diplomatic importance, not alphabetically. Include central parties, major powers, regional stakeholders, affected states, and useful coalition voices. Tag by region or role.`

  const prompt = `You are a senior MUN academic director preparing a portfolio matrix.

Committee: ${committee.name}
Type: ${committee.type}
Agenda: ${committee.agenda ?? "(not set)"}
Current date: ${today}
Scenario / research brief: ${explicitBrief}

Committee-specific rule: ${committeeRules}

Generate exactly ${count} entries. Rank the most important/relevant first. Use real countries, people, or roles only; no duplicates; no alphabetical padding. Current facts can change, so include a short sourceNote telling the director what must be verified before publishing.

Respond only with JSON: {"tagLabel":"Party, Participation, Region, Faction, or Desk","sourceNote":"...","portfolios":[{"name":"...","tag":"...","priority":1}]}. Priority 1 is most important and must increase sequentially.`

  try {
    const raw = await callAI<unknown>(prompt)
    const parsed = portfolioListSchema.safeParse(raw)
    if (!parsed.success) {
      return { success: false, error: "AI returned an invalid list, try again." }
    }
    const seen = new Set<string>()
    const unique = parsed.data.portfolios.filter((entry) => {
      const key = entry.name.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    return {
      success: true,
      portfolios: unique.slice(0, count).map((entry, index) => ({
        name: entry.name.trim(),
        tag: entry.tag.trim(),
        priority: index + 1,
      })),
      tagLabel: parsed.data.tagLabel,
      sourceNote: parsed.data.sourceNote,
    }
  } catch (err) {
    if (err instanceof AIRateLimitError) {
      return { success: false, error: err.message, rateLimited: true }
    }
    return { success: false, error: err instanceof Error ? err.message : "AI generation failed." }
  }
}

// ── Fees ───────────────────────────────────────────────────────────────────────
export async function createFee(data: {
  label: string
  committeeType: string
  isDtu: boolean
  amountInr: number
}): Promise<{ success: boolean; error?: string }> {
  const session = await requireAdmin()
  try {
    const fee = await prisma.fee.create({ data })
    await audit(session.user?.email ?? "unknown", "fee.create", "Fee", fee.id, { ...data })
    return { success: true }
  } catch {
    return { success: false, error: "Failed to create fee." }
  }
}

export async function updateFee(
  id: string,
  data: {
    label: string
    committeeType: string
    isDtu: boolean
    amountInr: number
  },
): Promise<{ success: boolean; error?: string }> {
  const session = await requireAdmin()
  try {
    await prisma.fee.update({ where: { id }, data })
    await audit(session.user?.email ?? "unknown", "fee.update", "Fee", id, { ...data })
    return { success: true }
  } catch {
    return { success: false, error: "Failed to update fee." }
  }
}

export async function deleteFee(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireAdmin()
  try {
    await prisma.fee.delete({ where: { id } })
    await audit(session.user?.email ?? "unknown", "fee.delete", "Fee", id)
    return { success: true }
  } catch {
    return { success: false, error: "Failed to delete fee." }
  }
}
