import { prisma } from "@/lib/prisma"
import { getContent } from "@/lib/settings"
import { APP_URL } from "@/lib/app-url"
import { deserializeSettingValue } from "@/lib/setting-value"
import { EMAIL_TRANSPORT_NAME, sendMailerEmail } from "@/lib/resend"
import {
  buildContactAudienceWhere,
  buildDelegateAudienceWhere,
  parseContactAudience,
  parseDelegateAudience,
} from "./audience"
import { firstName, paragraphs, renderMerge, type MergeVars } from "./merge"
import { signUnsubscribeToken } from "./unsubscribe"

// The mail queue. Every campaign and every recipient is a row, so a send that
// is interrupted by a deploy or a crash resumes on the next tick instead of being
// lost. It is driven two ways: kicked with after() the moment somebody presses
// Send, and ticked every two minutes from cron on each box, which also picks up
// scheduled mail. Both can run at once, so every step claims its row with a
// conditional update before acting.

export const PR_MAIL_SETTING = "prMailEnabled"

const CONCURRENCY = 8
const PER_RUN = 60
const STALE_CLAIM_MS = 15 * 60 * 1000

// How many mailer emails may go out in any 24 hours.
//
// Resend's free plan allows 100 a day across everything the site sends, sign-in
// links included, so on Resend this stops at 90 and leaves room for people to
// log in. A campaign bigger than the cap is not refused: it keeps sending on
// later ticks as the window rolls forward.
export function dailyCap(): number {
  const fromEnv = Number(process.env.MAIL_DAILY_CAP)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv)
  return EMAIL_TRANSPORT_NAME === "ses" ? 2000 : 90
}

// PR mail to the outreach list stays off until an admin switches it on. The
// SES production request describes transactional mail only, and Resend's free
// plan cannot carry a campaign, so outreach needs a deliberate decision rather
// than a default.
export async function prMailEnabled(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: PR_MAIL_SETTING } })
  const value = row ? deserializeSettingValue(row.value) : undefined
  return value === true || value === "true"
}

type Content = Awaited<ReturnType<typeof getContent>>

// The fields every recipient shares. Exported, with recipientMergeVars, so the
// composer's preview fills a mail exactly the way the real send does: a preview
// that merged differently would show one thing and deliver another.
export function baseMergeVars(content: Content): MergeVars {
  return {
    event: content.activeEventName || content.landingHero.title,
    dates: content.conferenceDates,
    venue: content.venue,
    registerLink: `${APP_URL}/register`,
    whatsapp: content.whatsappCommunityUrl,
  }
}

export async function recipientMergeVars(
  base: MergeVars,
  name: string | null,
  delegateId: string | null,
): Promise<MergeVars> {
  const vars: MergeVars = { ...base, name: name ?? "", firstName: firstName(name ?? "") }
  if (!delegateId) return vars
  const d = await prisma.delegate.findUnique({
    where: { id: delegateId },
    select: {
      publicToken: true,
      allotment: { select: { portfolio: { select: { name: true, committee: { select: { name: true } } } } } },
    },
  })
  if (!d) return vars
  vars.statusLink = `${APP_URL}/status/${d.publicToken}`
  if (d.allotment) {
    vars.portfolio = d.allotment.portfolio.name
    vars.committee = d.allotment.portfolio.committee.name
  }
  return vars
}

export interface QueueRunResult {
  started: number
  sent: number
  failed: number
  finished: number
  capped: boolean
}

export async function processMailQueue(now: Date = new Date()): Promise<QueueRunResult> {
  const prOn = await prMailEnabled()
  const started = await startDueCampaigns(now, prOn)

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const sentToday = await prisma.mailRecipient.count({ where: { status: "SENT", sentAt: { gte: since } } })
  const budget = Math.max(0, Math.min(PER_RUN, dailyCap() - sentToday))

  const { sent, failed } = await sendPending(budget, now, prOn)
  const finished = await finishCampaigns(now)
  return { started, sent, failed, finished, capped: budget === 0 }
}

async function startDueCampaigns(now: Date, prOn: boolean): Promise<number> {
  const due = await prisma.mailCampaign.findMany({
    where: { state: "SCHEDULED", scheduledAt: { lte: now } },
    select: { id: true, audience: true, filters: true, eventId: true },
    orderBy: { scheduledAt: "asc" },
    take: 5,
  })

  let started = 0
  for (const campaign of due) {
    // Left scheduled rather than failed, so switching PR mail on later resumes it.
    if (campaign.audience === "CONTACTS" && !prOn) continue

    const claimed = await prisma.mailCampaign.updateMany({
      where: { id: campaign.id, state: "SCHEDULED" },
      data: { state: "SENDING", startedAt: now },
    })
    if (claimed.count !== 1) continue

    // Recipients are resolved now, not when the mail was drafted, so a scheduled
    // mail reaches whoever matches its filters on the day it goes out.
    if (campaign.audience === "DELEGATES") {
      const delegates = campaign.eventId
        ? await prisma.delegate.findMany({
            where: buildDelegateAudienceWhere(parseDelegateAudience(campaign.filters), { eventId: campaign.eventId }),
            select: { id: true, email: true, fullName: true },
          })
        : []
      await prisma.mailRecipient.createMany({
        data: delegates.map((d) => ({
          campaignId: campaign.id,
          email: d.email.trim().toLowerCase(),
          name: d.fullName,
          delegateId: d.id,
        })),
        skipDuplicates: true,
      })
    } else {
      const contacts = await prisma.mailContact.findMany({
        where: buildContactAudienceWhere(parseContactAudience(campaign.filters), now),
        select: { id: true, email: true, name: true },
      })
      await prisma.mailRecipient.createMany({
        data: contacts.map((c) => ({
          campaignId: campaign.id,
          email: c.email.trim().toLowerCase(),
          name: c.name,
          contactId: c.id,
        })),
        skipDuplicates: true,
      })
    }
    started++
  }
  return started
}

async function sendPending(budget: number, now: Date, prOn: boolean): Promise<{ sent: number; failed: number }> {
  // A recipient claimed by a run that never finished is marked failed, not put
  // back in the queue. The provider may already have accepted it, and sending a
  // second copy is worse than a failure somebody can see and resend by hand.
  await prisma.mailRecipient.updateMany({
    where: { status: "SENDING", claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
    data: { status: "FAILED", error: "Interrupted before the provider confirmed it. Not retried, to avoid sending twice." },
  })
  if (budget <= 0) return { sent: 0, failed: 0 }

  const pending = await prisma.mailRecipient.findMany({
    where: {
      status: "PENDING",
      campaign: { state: "SENDING", ...(prOn ? {} : { audience: "DELEGATES" }) },
    },
    orderBy: { id: "asc" },
    take: budget,
    select: {
      id: true,
      email: true,
      name: true,
      delegateId: true,
      contactId: true,
      campaign: { select: { id: true, subject: true, body: true, ctaLabel: true, ctaUrl: true, audience: true } },
    },
  })
  if (pending.length === 0) return { sent: 0, failed: 0 }

  const content = await getContent()
  const base = baseMergeVars(content)
  const secret = process.env.AUTH_SECRET ?? ""

  let sent = 0
  let failed = 0
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (r) => {
        const claim = await prisma.mailRecipient.updateMany({
          where: { id: r.id, status: "PENDING" },
          data: { status: "SENDING", claimedAt: new Date() },
        })
        if (claim.count !== 1) return

        try {
          const vars = await recipientMergeVars(base, r.name, r.delegateId)

          let unsubscribeUrl: string | undefined
          let unsubscribePostUrl: string | undefined
          if (r.contactId) {
            const token = signUnsubscribeToken(r.contactId, secret)
            unsubscribeUrl = `${APP_URL}/unsubscribe/${token}`
            unsubscribePostUrl = `${APP_URL}/api/unsubscribe/${token}`
          }

          const ctaUrl = r.campaign.ctaUrl ? renderMerge(r.campaign.ctaUrl, vars) : undefined
          const ctaLabel = r.campaign.ctaLabel ? renderMerge(r.campaign.ctaLabel, vars) : undefined
          // A button whose link still holds an unfilled field would go nowhere,
          // so it is dropped for that recipient rather than sent broken.
          const button = ctaUrl && ctaLabel && !/\{[a-zA-Z]+\}/.test(ctaUrl) ? { ctaUrl, ctaLabel } : {}

          await sendMailerEmail({
            campaignId: r.campaign.id,
            toEmail: r.email,
            delegateId: r.delegateId ?? undefined,
            subject: renderMerge(r.campaign.subject, vars),
            paragraphs: paragraphs(renderMerge(r.campaign.body, vars)),
            eventName: base.event ?? "DelTech MUN",
            contactEmail: content.secretariatEmail,
            reason:
              r.campaign.audience === "CONTACTS"
                ? "You are receiving this because you asked to hear about DelTech MUN events."
                : `You are receiving this because you registered for ${base.event ?? "this event"}.`,
            unsubscribeUrl,
            unsubscribePostUrl,
            ...button,
          })

          await prisma.mailRecipient.update({ where: { id: r.id }, data: { status: "SENT", sentAt: new Date(), error: null } })
          if (r.contactId) {
            await prisma.mailContact.update({ where: { id: r.contactId }, data: { lastMailedAt: new Date() } })
          }
          sent++
        } catch (err) {
          await prisma.mailRecipient.update({
            where: { id: r.id },
            data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 500) : "Send failed." },
          })
          failed++
        }
      }),
    )
  }
  return { sent, failed }
}

async function finishCampaigns(now: Date): Promise<number> {
  const sending = await prisma.mailCampaign.findMany({ where: { state: "SENDING" }, select: { id: true } })
  let finished = 0
  for (const c of sending) {
    const left = await prisma.mailRecipient.count({
      where: { campaignId: c.id, status: { in: ["PENDING", "SENDING"] } },
    })
    if (left > 0) continue
    const done = await prisma.mailCampaign.updateMany({
      where: { id: c.id, state: "SENDING" },
      data: { state: "SENT", finishedAt: now },
    })
    finished += done.count
  }
  return finished
}
