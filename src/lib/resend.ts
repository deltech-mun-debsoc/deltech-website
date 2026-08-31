import type React from "react"
import { Resend } from "resend"
import { prisma } from "@/lib/prisma"
import { getContent } from "@/lib/settings"
import { STRINGS } from "@/content/strings"
import { APP_URL } from "@/lib/app-url"
import { RegistrationReceivedEmail } from "@/emails/registration-received"
import { AllotmentEmail } from "@/emails/allotment"
import { CoDelegateNoticeEmail } from "@/emails/co-delegate-notice"
import { CoDelegateRegisteredEmail } from "@/emails/co-delegate-registered"
import { PaymentConfirmedEmail } from "@/emails/payment-confirmed"
import { PaymentReminderEmail } from "@/emails/payment-reminder"
import { BlogApprovedEmail } from "@/emails/blog-approved"
import { BlogChangesRequestedEmail } from "@/emails/blog-changes-requested"
import { BlogRejectedEmail } from "@/emails/blog-rejected"
import { StaffInviteEmail } from "@/emails/staff-invite"
import { MagicLinkEmail } from "@/emails/magic-link"
import { RecruitmentSelectedEmail } from "@/emails/recruitment-selected"
import { parseCycleConfig } from "@/lib/schemas/recruitment"
import { MAGIC_LINK_MAX_AGE_MIN } from "@/lib/magic-link"
import { deriveEventState } from "@/lib/event-state"
import { publicPaymentLink } from "@/lib/payments/public-link"

let resendClient: Resend | undefined
function getResend(): Resend {
  return (resendClient ??= new Resend(process.env.AUTH_RESEND_KEY))
}
const FROM = process.env.EMAIL_FROM ?? "noreply@deltechmun.in"
const REDIRECT_TO = process.env.EMAIL_REDIRECT_TO?.trim()


// ---------------------------------------------------------------------------
// Core send + log helper
// ---------------------------------------------------------------------------

async function loggedSend({
  delegateId,
  template,
  toEmail,
  subject,
  reactElement,
}: {
  delegateId?: string
  template: string
  toEmail: string
  subject: string
  reactElement: React.ReactElement
}): Promise<void> {
  let status = "SENT"
  let error: string | undefined

  try {
    const recipient = REDIRECT_TO || toEmail
    const deliveredSubject = REDIRECT_TO ? `[STAGING → ${toEmail}] ${subject}` : subject
    const { error: apiError } = await getResend().emails.send({
      from: FROM,
      to: recipient,
      subject: deliveredSubject,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      react: reactElement as any,
    })
    if (apiError) {
      status = "FAILED"
      error = apiError.message
    }
  } catch (err) {
    status = "FAILED"
    error = err instanceof Error ? err.message : String(err)
  }

  await prisma.emailLog.create({
    data: { delegateId, template, toEmail, status, error },
  })

  if (status === "FAILED") {
    throw new Error(`Email send failed [${template}→${toEmail}]: ${error}`)
  }
}

// ---------------------------------------------------------------------------
// Per-template helpers (each fetches its own data from delegateId)
// ---------------------------------------------------------------------------

export async function sendRegistrationReceived(delegateId: string): Promise<void> {
  const delegate = await prisma.delegate.findUniqueOrThrow({
    where: { id: delegateId },
    select: { fullName: true, email: true, publicToken: true },
  })
  const content = await getContent()
  const paymentsEnabled = deriveEventState(content).paymentsRequired

  await loggedSend({
    delegateId,
    template: "registration-received",
    toEmail: delegate.email,
    subject: STRINGS.email.subjects.registrationReceived,
    reactElement: RegistrationReceivedEmail({
      fullName: delegate.fullName,
      email: delegate.email,
      eventName: content.activeEventName || content.landingHero.title,
      paymentsEnabled,
      statusUrl: `${APP_URL}/status/${delegate.publicToken}`,
    }),
  })
}

/**
 * Co-delegates are real participants but did not submit the form, so they get their
 * own template, and deliberately never the primary's `statusUrl`. That token is a
 * bearer credential for /status/<token> AND /pay/<token>; the primary did not consent
 * to sharing a payment surface.
 */
export async function sendCoDelegateRegistered(delegateId: string): Promise<void> {
  const delegate = await prisma.delegate.findUniqueOrThrow({
    where: { id: delegateId },
    select: {
      fullName: true,
      email: true,
      pref1CommitteeId: true,
      coDelegate: { select: { fullName: true, email: true } },
    },
  })

  if (!delegate.coDelegate) return

  // Delegate.pref1CommitteeId is a plain column, not a Prisma relation.
  const committee = delegate.pref1CommitteeId
    ? await prisma.committee.findUnique({
        where: { id: delegate.pref1CommitteeId },
        select: { name: true },
      })
    : null

  const content = await getContent()
  const paymentsEnabled = deriveEventState(content).paymentsRequired

  await loggedSend({
    delegateId,
    template: "co-delegate-registered",
    toEmail: delegate.coDelegate.email,
    subject: STRINGS.email.subjects.coDelegateRegistered,
    reactElement: CoDelegateRegisteredEmail({
      coDelegateName: delegate.coDelegate.fullName,
      primaryDelegateName: delegate.fullName,
      primaryDelegateEmail: delegate.email,
      eventName: content.activeEventName || content.landingHero.title,
      committeeName: committee?.name ?? null,
      paymentsEnabled,
    }),
  })
}

/**
 * Fan-out for every registration entry point. Both sends are attempted regardless of
 * the other's outcome; failures are aggregated so the caller can log once.
 */
export async function sendRegistrationEmails(delegateId: string): Promise<void> {
  const results = await Promise.allSettled([
    sendRegistrationReceived(delegateId),
    sendCoDelegateRegistered(delegateId),
  ])

  const reasons = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)))

  if (reasons.length > 0) {
    throw new Error(`Registration emails failed for ${delegateId}: ${reasons.join(" | ")}`)
  }
}

export async function sendAllotmentEmail(delegateId: string): Promise<void> {
  const delegate = await prisma.delegate.findUniqueOrThrow({
    where: { id: delegateId },
    select: {
      fullName: true,
      email: true,
      publicToken: true,
      needsAccommodation: true,
      allotment: {
        include: {
          portfolio: { include: { committee: true } },
        },
      },
      payment: { select: { amountInr: true, paymentLink: true } },
    },
  })

  if (!delegate.allotment) {
    throw new Error(`Delegate ${delegateId} has no allotment record`)
  }

  const committee = delegate.allotment.portfolio.committee
  const portfolio = delegate.allotment.portfolio
  const content = await getContent()

  const subject = STRINGS.email.subjects.allotmentSent
    .replace("{committee}", committee.name)
    .replace("{portfolio}", portfolio.name)

  const paymentsEnabled = deriveEventState(content).paymentsRequired
  const payLink = publicPaymentLink(delegate.payment?.paymentLink, delegate.publicToken)

  await loggedSend({
    delegateId,
    template: "allotment",
    toEmail: delegate.email,
    subject,
    reactElement: AllotmentEmail({
      eventName: content.activeEventName || content.landingHero.title,
      fullName: delegate.fullName,
      committeeName: committee.name,
      portfolioName: portfolio.name,
      agenda: committee.agenda ?? null,
      amountInr: delegate.payment?.amountInr,
      payLink: paymentsEnabled ? payLink : undefined,
      paymentsEnabled,
      needsAccommodation: delegate.needsAccommodation,
      accommodationNote: content.accommodationNote,
      conferenceDates: content.conferenceDates,
      venue: content.venue,
      paymentDeadline: content.paymentDeadline,
      paymentProofUrl: content.paymentProofUrl,
      refundPolicy: content.refundPolicy,
      contactEmail: content.secretariatEmail,
      contacts: content.queryContacts,
    }),
  })

  await prisma.allotment.update({
    where: { delegateId },
    data: { emailSentAt: new Date() },
  })
}

export async function sendCoDelegateNotice(delegateId: string): Promise<void> {
  const delegate = await prisma.delegate.findUniqueOrThrow({
    where: { id: delegateId },
    select: {
      fullName: true,
      coDelegate: true,
      allotment: {
        include: { portfolio: { include: { committee: true } } },
      },
    },
  })

  if (!delegate.coDelegate || !delegate.allotment) return

  const committee = delegate.allotment.portfolio.committee
  const portfolio = delegate.allotment.portfolio
  const content = await getContent()
  const paymentsEnabled = deriveEventState(content).paymentsRequired
  const subject = STRINGS.email.subjects.coDelegateNotice.replace("{committee}", committee.name)

  await loggedSend({
    delegateId,
    template: "co-delegate-notice",
    toEmail: delegate.coDelegate.email,
    subject,
    reactElement: CoDelegateNoticeEmail({
      coDelegateName: delegate.coDelegate.fullName,
      primaryDelegateName: delegate.fullName,
      committeeName: committee.name,
      portfolioName: portfolio.name,
      paymentsEnabled,
    }),
  })
}

export async function sendPaymentConfirmed(delegateId: string): Promise<void> {
  const delegate = await prisma.delegate.findUniqueOrThrow({
    where: { id: delegateId },
    select: {
      fullName: true,
      email: true,
      allotment: {
        include: { portfolio: { include: { committee: true } } },
      },
      payment: { select: { amountInr: true, confirmedAt: true } },
    },
  })

  if (!delegate.allotment || !delegate.payment) return

  const committee = delegate.allotment.portfolio.committee
  const portfolio = delegate.allotment.portfolio
  const content = await getContent()

  await loggedSend({
    delegateId,
    template: "payment-confirmed",
    toEmail: delegate.email,
    subject: STRINGS.email.subjects.paymentConfirmed,
    reactElement: PaymentConfirmedEmail({
      eventName: content.activeEventName || content.landingHero.title,
      fullName: delegate.fullName,
      committeeName: committee.name,
      portfolioName: portfolio.name,
      amountInr: delegate.payment.amountInr,
      confirmedAt: delegate.payment.confirmedAt ?? new Date(),
      whatsappCommunityUrl: content.whatsappCommunityUrl,
      contactEmail: content.secretariatEmail,
      contacts: content.queryContacts,
    }),
  })
}

export async function sendPaymentReminder(delegateId: string): Promise<void> {
  const content = await getContent()
  if (!deriveEventState(content).paymentsRequired) return

  const delegate = await prisma.delegate.findUniqueOrThrow({
    where: { id: delegateId },
    select: {
      fullName: true,
      email: true,
      publicToken: true,
      allotment: {
        include: { portfolio: { include: { committee: true } } },
      },
      payment: { select: { amountInr: true, paymentLink: true } },
    },
  })

  if (!delegate.allotment || !delegate.payment) return

  const committee = delegate.allotment.portfolio.committee
  const portfolio = delegate.allotment.portfolio
  const payLink = publicPaymentLink(delegate.payment.paymentLink, delegate.publicToken)

  await loggedSend({
    delegateId,
    template: "payment-reminder",
    toEmail: delegate.email,
    subject: STRINGS.email.subjects.paymentReminder,
    reactElement: PaymentReminderEmail({
      fullName: delegate.fullName,
      committeeName: committee.name,
      portfolioName: portfolio.name,
      amountInr: delegate.payment.amountInr,
      payLink,
    }),
  })
}

export async function sendBlogApproved(postId: string): Promise<void> {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    select: { title: true, slug: true, author: { select: { name: true, email: true } } },
  })

  const subject = STRINGS.email.subjects.blogApproved.replace("{title}", post.title)
  const postUrl = `${APP_URL}/blog/${post.slug}`

  await loggedSend({
    template: "blog-approved",
    toEmail: post.author.email!,
    subject,
    reactElement: BlogApprovedEmail({
      authorName: post.author.name ?? "Author",
      postTitle: post.title,
      postUrl,
    }),
  })
}

export async function sendBlogChangesRequested(postId: string): Promise<void> {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    select: {
      title: true,
      reviewNote: true,
      author: { select: { name: true, email: true } },
    },
  })

  const subject = STRINGS.email.subjects.blogChangesRequested.replace("{title}", post.title)
  const editUrl = `${APP_URL}/write/${postId}`

  await loggedSend({
    template: "blog-changes-requested",
    toEmail: post.author.email!,
    subject,
    reactElement: BlogChangesRequestedEmail({
      authorName: post.author.name ?? "Author",
      postTitle: post.title,
      reviewNote: post.reviewNote ?? "",
      editUrl,
    }),
  })
}

export async function sendBlogRejected(postId: string): Promise<void> {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    select: {
      title: true,
      reviewNote: true,
      author: { select: { name: true, email: true } },
    },
  })

  await loggedSend({
    template: "blog-rejected",
    toEmail: post.author.email!,
    subject: STRINGS.email.subjects.blogRejected.replace("{title}", post.title),
    reactElement: BlogRejectedEmail({
      authorName: post.author.name ?? "Author",
      postTitle: post.title,
      reviewNote: post.reviewNote ?? "",
    }),
  })
}

// The "you're in" email for one selected candidate.
//
// Deliberately NOT fired by finalisation. The WhatsApp invite usually does not
// exist yet when the decision is recorded, and a result should not wait on a
// link -- so sending is its own action the secretariat runs once, when they are
// ready, over everyone selected.
export const RECRUITMENT_SELECTED_TEMPLATE = "recruitment-selected"

export async function sendRecruitmentSelected(candidateId: string): Promise<void> {
  const candidate = await prisma.recruitmentCandidate.findUniqueOrThrow({
    where: { id: candidateId },
    select: {
      fullName: true,
      email: true,
      result: true,
      societyRole: true,
      cycle: { select: { name: true, config: true } },
    },
  })

  // Belt and braces: the action filters on this, but a template that can mail
  // "you're in" to a rejected candidate is not one to leave unguarded.
  if (candidate.result !== "SELECTED") {
    throw new Error(`Candidate ${candidateId} is ${candidate.result}, not SELECTED`)
  }

  const selection = parseCycleConfig(candidate.cycle.config).selectionEmail
  const content = await getContent()

  await loggedSend({
    template: RECRUITMENT_SELECTED_TEMPLATE,
    toEmail: candidate.email,
    subject: STRINGS.email.subjects.recruitmentSelected,
    reactElement: RecruitmentSelectedEmail({
      fullName: candidate.fullName,
      cycleName: candidate.cycle.name,
      societyRole: candidate.societyRole,
      whatsappUrl: selection.whatsappUrl,
      note: selection.note,
      contactEmail: content.secretariatEmail,
      contacts: content.queryContacts,
    }),
  })
}

export async function sendStaffInvite(email: string, role: string): Promise<void> {
  await loggedSend({
    template: "staff-invite",
    toEmail: email,
    subject: "You've been added to the DelTech MUN secretariat",
    reactElement: StaffInviteEmail({ role, signInUrl: `${APP_URL}/signin/staff` }),
  })
}

// Auth.js would otherwise send its own unbranded default for this one, on a
// raw fetch that never touches EmailLog. Routing it through loggedSend puts
// magic links in the admin email log and the failed-email card like the rest.
export async function sendMagicLink(email: string, url: string): Promise<void> {
  await loggedSend({
    template: "magic-link",
    toEmail: email,
    subject: STRINGS.email.subjects.magicLink,
    reactElement: MagicLinkEmail({ url, expiryMinutes: MAGIC_LINK_MAX_AGE_MIN }),
  })
}

// ---------------------------------------------------------------------------
// Resend by log ID (admin drawer)
// ---------------------------------------------------------------------------

const RESENDABLE_TEMPLATES: Record<string, (id: string) => Promise<void>> = {
  "registration-received": sendRegistrationReceived,
  "co-delegate-registered": sendCoDelegateRegistered,
  allotment: sendAllotmentEmail,
  "co-delegate-notice": sendCoDelegateNotice,
  "payment-confirmed": sendPaymentConfirmed,
  "payment-reminder": sendPaymentReminder,
}

export async function resendByLogId(logId: string): Promise<void> {
  const log = await prisma.emailLog.findUniqueOrThrow({ where: { id: logId } })
  const fn = RESENDABLE_TEMPLATES[log.template]
  if (!fn) throw new Error(`Template "${log.template}" cannot be resent via logId`)
  if (!log.delegateId) throw new Error(`Log ${logId} has no delegateId`)
  await fn(log.delegateId)
}
