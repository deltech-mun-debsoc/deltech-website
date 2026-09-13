"use server"

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { render } from "@react-email/components"
import { prisma } from "@/lib/prisma"
import { requireAdmin, requireStaff } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { getActiveEvent } from "@/lib/event"
import { getContent } from "@/lib/settings"
import { APP_URL } from "@/lib/app-url"
import { normalizeEmail } from "@/lib/intake"
import { sendMailerEmail } from "@/lib/resend"
import { MailerEmail } from "@/emails/mailer"
import {
  buildContactAudienceWhere,
  buildDelegateAudienceWhere,
  parseContactAudience,
  parseDelegateAudience,
} from "@/lib/mailer/audience"
import { paragraphs, renderMerge, unfilledFields, type MergeVars } from "@/lib/mailer/merge"
import { presetFor, type PresetDraft } from "@/lib/mailer/presets"
import { baseMergeVars, dailyCap, PR_MAIL_SETTING, prMailEnabled, processMailQueue, recipientMergeVars } from "@/lib/mailer/queue"

export interface CampaignInput {
  id?: string
  audience: "DELEGATES" | "CONTACTS"
  filters: unknown
  preset: string
  subject: string
  body: string
  ctaLabel?: string
  ctaUrl?: string
}

type Result<T = object> = ({ success: true } & T) | { success: false; error: string }

function validate(input: CampaignInput): string | null {
  if (input.audience !== "DELEGATES" && input.audience !== "CONTACTS") return "Choose who this goes to."
  if (!input.subject.trim() || input.subject.length > 200) return "Write a subject under 200 characters."
  if (!input.body.trim() || input.body.length > 20000) return "Write the mail before sending it."
  const label = input.ctaLabel?.trim() ?? ""
  const url = input.ctaUrl?.trim() ?? ""
  if (label.length > 60) return "Keep the button label short."
  if (!!label !== !!url) return "A button needs both a label and a link."
  if (url && !/^https:\/\/\S+$/.test(url) && !/^\{(statusLink|registerLink|whatsapp)\}$/.test(url)) {
    return "The button link must start with https://, or be {statusLink} or {registerLink}."
  }
  return null
}

function normalised(input: CampaignInput) {
  return {
    audience: input.audience,
    filters:
      input.audience === "DELEGATES" ? parseDelegateAudience(input.filters) : parseContactAudience(input.filters),
    preset: input.preset || "custom",
    subject: input.subject.trim(),
    body: input.body.trim(),
    ctaLabel: input.ctaLabel?.trim() || null,
    ctaUrl: input.ctaUrl?.trim() || null,
  }
}

// Who would receive it right now, and a sample of them for the preview.
async function resolveAudience(input: CampaignInput, take: number) {
  const now = new Date()
  if (input.audience === "DELEGATES") {
    const event = await getActiveEvent()
    if (!event) return { count: 0, sample: [] as { name: string | null; email: string; delegateId: string | null }[], noEvent: true }
    const where = buildDelegateAudienceWhere(parseDelegateAudience(input.filters), { eventId: event.id })
    const [count, rows] = await Promise.all([
      prisma.delegate.count({ where }),
      prisma.delegate.findMany({ where, take, orderBy: { createdAt: "asc" }, select: { id: true, email: true, fullName: true } }),
    ])
    return { count, sample: rows.map((r) => ({ name: r.fullName, email: r.email, delegateId: r.id })), noEvent: false }
  }
  const where = buildContactAudienceWhere(parseContactAudience(input.filters), now)
  const [count, rows] = await Promise.all([
    prisma.mailContact.count({ where }),
    prisma.mailContact.findMany({ where, take, orderBy: { createdAt: "asc" }, select: { email: true, name: true } }),
  ])
  return { count, sample: rows.map((r) => ({ name: r.name, email: r.email, delegateId: null })), noEvent: false }
}

export async function presetDraft(key: string): Promise<PresetDraft> {
  await requireStaff()
  const [content, event] = await Promise.all([getContent(), getActiveEvent()])
  const daysToGo = event?.startsAt ? Math.ceil((event.startsAt.getTime() - Date.now()) / 86400000) : null
  return presetFor(key).build({
    eventName: content.activeEventName || content.landingHero.title,
    dates: content.conferenceDates,
    venue: content.venue,
    registerUrl: `${APP_URL}/register`,
    whatsappUrl: content.whatsappCommunityUrl,
    secretariatEmail: content.secretariatEmail,
    paymentDeadline: content.paymentDeadline,
    daysToGo,
  })
}

// Recipient count, a rendered preview for the first of them, and any merge
// fields that recipient has no value for. The preview goes through the same
// merge helpers the queue uses, so what is shown is what is sent.
export async function previewMail(
  input: CampaignInput,
): Promise<Result<{ count: number; html: string; sampleTo: string | null; unfilled: string[]; dailyCap: number; noEvent: boolean }>> {
  await requireStaff()
  const problem = validate({ ...input, subject: input.subject || " ", body: input.body || " " })
  if (problem && !/subject|mail before/.test(problem)) return { success: false, error: problem }

  const content = await getContent()
  const { count, sample, noEvent } = await resolveAudience(input, 1)
  const first = sample[0]
  const vars: MergeVars = first
    ? await recipientMergeVars(baseMergeVars(content), first.name, first.delegateId)
    : baseMergeVars(content)

  const subject = renderMerge(input.subject, vars)
  const ctaUrl = input.ctaUrl ? renderMerge(input.ctaUrl, vars) : undefined
  const html = await render(
    MailerEmail({
      eventName: vars.event ?? "DelTech MUN",
      subject: subject || "(no subject yet)",
      paragraphs: paragraphs(renderMerge(input.body, vars)),
      ctaLabel: input.ctaLabel || undefined,
      ctaUrl: ctaUrl && !/\{[a-zA-Z]+\}/.test(ctaUrl) ? ctaUrl : undefined,
      contactEmail: content.secretariatEmail,
      reason:
        input.audience === "CONTACTS"
          ? "You are receiving this because you asked to hear about DelTech MUN events."
          : `You are receiving this because you registered for ${vars.event ?? "this event"}.`,
      unsubscribeUrl: input.audience === "CONTACTS" ? `${APP_URL}/unsubscribe/preview` : undefined,
    }),
  )
  const unfilled = unfilledFields(`${input.subject}\n${input.body}\n${input.ctaUrl ?? ""}`, vars)
  return { success: true, count, html, sampleTo: first?.email ?? null, unfilled, dailyCap: dailyCap(), noEvent }
}

export async function saveCampaign(input: CampaignInput): Promise<Result<{ id: string }>> {
  const session = await requireStaff()
  const problem = validate(input)
  if (problem) return { success: false, error: problem }
  const data = normalised(input)

  if (input.id) {
    const updated = await prisma.mailCampaign.updateMany({
      where: { id: input.id, state: "DRAFT" },
      data: { ...data, filters: data.filters as object },
    })
    if (updated.count !== 1) return { success: false, error: "Only a draft can be edited. Duplicate it to change a sent mail." }
    revalidatePath("/admin/mailer")
    return { success: true, id: input.id }
  }
  const created = await prisma.mailCampaign.create({
    data: { ...data, filters: data.filters as object, createdBy: session.user?.email ?? "unknown" },
    select: { id: true },
  })
  revalidatePath("/admin/mailer")
  return { success: true, id: created.id }
}

// Sends the draft to the person pressing the button, merged as its first real
// recipient, so the fields, the button and the layout can be checked in a real
// inbox before anybody else gets it.
export async function sendTestMail(input: CampaignInput): Promise<Result<{ to: string }>> {
  const session = await requireStaff()
  const problem = validate(input)
  if (problem) return { success: false, error: problem }
  const to = session.user?.email
  if (!to) return { success: false, error: "Your account has no email address to test with." }

  const content = await getContent()
  const { sample } = await resolveAudience(input, 1)
  const first = sample[0]
  const vars = first
    ? await recipientMergeVars(baseMergeVars(content), first.name, first.delegateId)
    : baseMergeVars(content)
  const ctaUrl = input.ctaUrl ? renderMerge(input.ctaUrl, vars) : undefined
  try {
    await sendMailerEmail({
      campaignId: "test",
      toEmail: to,
      subject: `[Test] ${renderMerge(input.subject, vars)}`,
      paragraphs: paragraphs(renderMerge(input.body, vars)),
      eventName: vars.event ?? "DelTech MUN",
      contactEmail: content.secretariatEmail,
      reason: "This is a test of a mail drafted in the DelTech MUN admin mailer.",
      ...(ctaUrl && input.ctaLabel && !/\{[a-zA-Z]+\}/.test(ctaUrl) ? { ctaUrl, ctaLabel: input.ctaLabel } : {}),
    })
    return { success: true, to }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "The test mail failed." }
  }
}

// Sending is ADMIN only. A mail to every delegate cannot be recalled, so the
// last step belongs to the people who answer for it; any staff member can still
// draft, preview and test.
export async function scheduleCampaign(id: string, whenIso: string | null): Promise<Result> {
  const session = await requireAdmin()
  const campaign = await prisma.mailCampaign.findUnique({ where: { id } })
  if (!campaign || campaign.state !== "DRAFT") return { success: false, error: "Only a draft can be sent." }

  if (campaign.audience === "CONTACTS" && !(await prMailEnabled())) {
    return { success: false, error: "PR mail is switched off. An admin has to switch it on from Outreach contacts first." }
  }

  let when = new Date()
  if (whenIso) {
    when = new Date(whenIso)
    if (Number.isNaN(when.getTime())) return { success: false, error: "That send time is not valid." }
  }

  const input: CampaignInput = {
    audience: campaign.audience,
    filters: campaign.filters,
    preset: campaign.preset,
    subject: campaign.subject,
    body: campaign.body,
    ctaLabel: campaign.ctaLabel ?? undefined,
    ctaUrl: campaign.ctaUrl ?? undefined,
  }
  const { count, noEvent } = await resolveAudience(input, 0)
  if (noEvent) return { success: false, error: "No event is running, so there are no delegates to mail." }
  if (count === 0 && when.getTime() <= Date.now()) return { success: false, error: "Nobody matches these filters." }

  const event = campaign.audience === "DELEGATES" ? await getActiveEvent() : null
  const updated = await prisma.mailCampaign.updateMany({
    where: { id, state: "DRAFT" },
    data: { state: "SCHEDULED", scheduledAt: when, eventId: event?.id ?? null },
  })
  if (updated.count !== 1) return { success: false, error: "This mail changed while you were looking at it. Reload and try again." }

  await audit(session.user?.email ?? "unknown", "mailer.schedule", "MailCampaign", id, {
    audience: campaign.audience,
    recipientsNow: count,
    scheduledAt: when.toISOString(),
  })
  // Start at once if it is due; the two-minute tick is the backstop, and picks
  // up anything scheduled for later.
  if (when.getTime() <= Date.now()) after(() => processMailQueue().then(() => undefined))
  revalidatePath("/admin/mailer")
  return { success: true }
}

export async function cancelCampaign(id: string): Promise<Result> {
  const session = await requireAdmin()
  const updated = await prisma.mailCampaign.updateMany({
    where: { id, state: { in: ["DRAFT", "SCHEDULED", "SENDING"] } },
    data: { state: "CANCELLED", finishedAt: new Date() },
  })
  if (updated.count !== 1) return { success: false, error: "That mail has already finished." }
  // Whoever has not been sent to yet is not sent to. Anything already sent stays sent.
  await prisma.mailRecipient.updateMany({
    where: { campaignId: id, status: "PENDING" },
    data: { status: "SKIPPED", error: "Cancelled before sending." },
  })
  await audit(session.user?.email ?? "unknown", "mailer.cancel", "MailCampaign", id)
  revalidatePath("/admin/mailer")
  return { success: true }
}

export async function duplicateCampaign(id: string): Promise<Result<{ id: string }>> {
  const session = await requireStaff()
  const c = await prisma.mailCampaign.findUnique({ where: { id } })
  if (!c) return { success: false, error: "That mail no longer exists." }
  const copy = await prisma.mailCampaign.create({
    data: {
      audience: c.audience,
      filters: c.filters as object,
      preset: c.preset,
      subject: c.subject,
      body: c.body,
      ctaLabel: c.ctaLabel,
      ctaUrl: c.ctaUrl,
      createdBy: session.user?.email ?? "unknown",
    },
    select: { id: true },
  })
  revalidatePath("/admin/mailer")
  return { success: true, id: copy.id }
}

// For a campaign held back by the daily cap: send what the window allows now
// instead of waiting for the next tick.
export async function runQueueNow(): Promise<Result<{ sent: number; capped: boolean }>> {
  await requireAdmin()
  const r = await processMailQueue()
  revalidatePath("/admin/mailer")
  return { success: true, sent: r.sent, capped: r.capped }
}

// ---- Outreach contacts ----

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => /^[a-z0-9][a-z0-9 _-]{0,39}$/.test(t)))]
}

// Adds contacts, or merges tags onto ones already on the list. It never clears
// an unsubscribe: somebody who opted out stays out however often they appear in
// an imported sheet.
export async function addContacts(
  rows: { email: string; name?: string; institution?: string }[],
  tags: string[],
  source: string,
): Promise<Result<{ added: number; updated: number; invalid: number }>> {
  await requireStaff()
  if (rows.length > 5000) return { success: false, error: "Import at most 5000 contacts at a time." }
  const tagList = cleanTags(tags)
  let added = 0
  let updated = 0
  let invalid = 0

  for (const row of rows) {
    const email = normalizeEmail(row.email ?? "")
    if (!EMAIL.test(email)) {
      invalid++
      continue
    }
    const existing = await prisma.mailContact.findUnique({ where: { email }, select: { id: true, tags: true } })
    if (existing) {
      await prisma.mailContact.update({
        where: { id: existing.id },
        data: {
          tags: [...new Set([...existing.tags, ...tagList])],
          ...(row.name?.trim() ? { name: row.name.trim() } : {}),
          ...(row.institution?.trim() ? { institution: row.institution.trim() } : {}),
        },
      })
      updated++
    } else {
      await prisma.mailContact.create({
        data: {
          email,
          name: row.name?.trim() || null,
          institution: row.institution?.trim() || null,
          tags: tagList,
          source: source.trim().slice(0, 80) || null,
        },
      })
      added++
    }
  }
  revalidatePath("/admin/mailer/contacts")
  return { success: true, added, updated, invalid }
}

export async function removeContact(id: string): Promise<Result> {
  const session = await requireAdmin()
  await prisma.mailContact.delete({ where: { id } }).catch(() => null)
  await audit(session.user?.email ?? "unknown", "mailer.contact.remove", "MailContact", id)
  revalidatePath("/admin/mailer/contacts")
  return { success: true }
}

export async function setPrMailEnabled(enabled: boolean): Promise<Result> {
  const session = await requireAdmin()
  await prisma.setting.upsert({
    where: { key: PR_MAIL_SETTING },
    create: { key: PR_MAIL_SETTING, value: enabled },
    update: { value: enabled },
  })
  await audit(session.user?.email ?? "unknown", "mailer.pr.toggle", "Setting", PR_MAIL_SETTING, { enabled })
  revalidatePath("/admin/mailer/contacts")
  return { success: true }
}
