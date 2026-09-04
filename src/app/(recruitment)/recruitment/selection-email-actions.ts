"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { RecruitmentDenied, requireRecruitmentAction, resolveCycleContext } from "@/lib/recruitment/authz"
import { can, cycleAllows } from "@/lib/recruitment/permissions"
import { auditRecruitment, newRequestId } from "@/lib/recruitment/audit"
import {
  RECRUITMENT_SELECTED_TEMPLATE,
  recruitmentSelectedTemplate,
  sendRecruitmentSelected,
} from "@/lib/resend"
import { recruitmentRecipientEmails } from "@/lib/recruitment/recipient-emails"
import { failureRef, unexpectedFailureMessage } from "@/lib/prisma-errors"
import { parseCycleConfig } from "@/lib/schemas/recruitment"

// Emailing the people who got in.
//
// Its own action rather than a side effect of finalisation, because the two are
// not ready at the same moment: a decision is recorded the evening the panel
// finishes, and the group invite the secretariat wants to include usually does
// not exist for another day. Tying them together would either delay every result
// or send half the class an email with no link in it.
//
// Idempotent by construction: EmailLog already records every send, so a candidate
// who has a SENT row for this template is skipped. Pressing the button twice
// mails the people added since, and nobody twice.

export type SelectionEmailResponse =
  | { ok: true; sent: number; skipped: number; failed: number }
  | { ok: false; error: string }

export interface SelectionEmailStatus {
  selected: number
  alreadyEmailed: number
  pending: number
  hasGroupLink: boolean
  // The cycle has to be in FINALISATION (or COMPLETED) before results go out.
  // Reported rather than folded into a null, so an admin looking for the button
  // during IN_PROGRESS is told what to do instead of finding nothing.
  cycleReady: boolean
}

// What the button needs to describe itself honestly before it is pressed.
//
// Guards on candidate.recruit through `can` rather than requireRecruitmentAction,
// deliberately: the role decides whether the control exists, while the cycle state
// only decides whether it is pressable, and asserting both would hide the button
// from the person who needs to be told the cycle is not in Finalisation yet.
// @recruitment-guard candidate.recruit
export async function selectionEmailStatus(cycleId: string): Promise<SelectionEmailStatus | null> {
  // The ROLE decides whether the control exists at all; the cycle STATE only
  // decides whether it can be pressed yet. Asserting both here would hide the
  // button from the one person who needs to know why it is not there.
  const ctx = await resolveCycleContext(cycleId)
  if (!ctx || !can(ctx.role, "candidate.recruit")) return null

  const { pending, selected, emailed } = await pendingRecipients(ctx.cycle.id)
  const config = parseCycleConfig(ctx.cycle.config)
  return {
    selected: selected.length,
    alreadyEmailed: emailed.size,
    pending: pending.length,
    hasGroupLink: config.selectionEmail.whatsappUrl.length > 0,
    cycleReady: cycleAllows(ctx.cycle.state, "candidate.recruit"),
  }
}

async function pendingRecipients(cycleId: string) {
  const selected = await prisma.recruitmentCandidate.findMany({
    where: { cycleId, result: "SELECTED" },
    orderBy: { fullName: "asc" },
    select: { id: true, email: true, fullName: true, formAnswers: true },
  })
  if (selected.length === 0) return { selected, pending: [], emailed: new Set<string>() }

  const recipients = selected.map((candidate) => ({
    ...candidate,
    recipients: recruitmentRecipientEmails(candidate.email, candidate.formAnswers),
  }))
  const allEmails = [...new Set(recipients.flatMap((candidate) => candidate.recipients))]

  // New sends are keyed by candidate as well as address. The legacy unscoped
  // template remains recognised so a deployment cannot resend mail that went
  // out before candidate-scoped idempotency was introduced.
  const logs = await prisma.emailLog.findMany({
    where: {
      status: "SENT",
      toEmail: { in: allEmails },
      template: { startsWith: RECRUITMENT_SELECTED_TEMPLATE },
    },
    select: { template: true, toEmail: true },
  })
  const legacyEmails = new Set(
    logs.filter((log) => log.template === RECRUITMENT_SELECTED_TEMPLATE).map((log) => log.toEmail.toLowerCase()),
  )
  const scopedDeliveries = new Set(
    logs.map((log) => `${log.template}\u0000${log.toEmail.toLowerCase()}`),
  )
  const pending = recipients
    .map((candidate) => ({
      ...candidate,
      unsentRecipients: candidate.recipients.filter((email) =>
        !legacyEmails.has(email.toLowerCase())
        && !scopedDeliveries.has(`${recruitmentSelectedTemplate(candidate.id)}\u0000${email.toLowerCase()}`),
      ),
    }))
    .filter((candidate) => candidate.recipients.length === 0 || candidate.unsentRecipients.length > 0)
  const emailed = new Set(
    recipients.filter((candidate) => !pending.some((item) => item.id === candidate.id)).map((candidate) => candidate.id),
  )
  return { selected, pending, emailed }
}

export async function sendSelectionEmails(cycleId: string): Promise<SelectionEmailResponse> {
  let ctx
  try {
    ctx = await requireRecruitmentAction(cycleId, "candidate.recruit")
  } catch (err) {
    if (err instanceof RecruitmentDenied) {
      return { ok: false, error: "You are not permitted to email selected candidates." }
    }
    throw err
  }

  const requestId = newRequestId()

  try {
    const { pending, emailed } = await pendingRecipients(ctx.cycle.id)
    if (pending.length === 0) {
      return { ok: true, sent: 0, skipped: emailed.size, failed: 0 }
    }

    // Sequential on purpose. Resend rate-limits, and each address is logged on
    // its own. A retry therefore sends only the missing address for a candidate.
    let sent = 0
    let failedCandidates = 0
    const failures: string[] = []
    let deliveries = 0
    for (const candidate of pending) {
      let candidateFailed = candidate.recipients.length === 0
      if (candidateFailed) {
        failures.push(`${candidate.fullName}: no valid recipient address`)
      }
      for (const email of candidate.unsentRecipients) {
        try {
          await sendRecruitmentSelected(candidate.id, email)
          deliveries += 1
        } catch (err) {
          candidateFailed = true
          failures.push(email)
          console.error("[recruitment/selection-email]", requestId, candidate.id, email, err)
        }
      }
      if (!candidateFailed) {
        sent += 1
      } else {
        failedCandidates += 1
      }
    }

    await auditRecruitment({
      eventType: "candidate.selectionEmail",
      actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
      cycleId: ctx.cycle.id,
      reason: `Selection email sent to ${sent} of ${pending.length} selected candidates.`,
      meta: { sent, deliveries, failed: failedCandidates, failedDeliveries: failures.length, skipped: emailed.size, failures },
      outcome: failedCandidates > 0 ? "FAILED" : "SUCCESS",
      requestId,
    })

    revalidatePath("/recruitment", "layout")
    return { ok: true, sent, skipped: emailed.size, failed: failedCandidates }
  } catch (err) {
    const ref = failureRef(err)
    console.error("[recruitment/selection-email]", ref.ref, ref.code ?? "-", err)
    return { ok: false, error: unexpectedFailureMessage(ref) }
  }
}
