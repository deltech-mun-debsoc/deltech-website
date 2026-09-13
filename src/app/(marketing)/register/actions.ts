"use server"

import { prisma } from "@/lib/prisma"
import { getContent } from "@/lib/settings"
import { registerSchema, type RegisterFormValues } from "@/lib/schemas/register"
import { sendRegistrationEmails } from "@/lib/resend"
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { deriveEventState } from "@/lib/event-state"
import { getActiveEvent, INACTIVE_STATES } from "@/lib/event"
import type { Prisma } from "@/generated/prisma/client"

type ActionResult =
  | { success: true; delegateId: string; publicToken: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

export async function registerDelegate(data: RegisterFormValues): Promise<ActionResult> {
  // Server-side registration guard
  const content = await getContent()
  if (!deriveEventState(content).acceptsRegistrations) {
    return { success: false, error: "Registrations are currently closed." }
  }

  // Keyed on the submitted email so a flood cannot lock out other applicants.
  if (data?.email) {
    const limit = await rateLimit(RATE_LIMITS.register, data.email)
    if (!limit.ok) {
      return { success: false, error: "Too many attempts. Wait a few minutes and try again." }
    }
  }

  // Validate with shared schema
  const parsed = registerSchema.safeParse(data)
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".")
      if (!fieldErrors[path]) fieldErrors[path] = []
      fieldErrors[path].push(issue.message)
    }
    return { success: false, error: "Validation failed.", fieldErrors }
  }

  const vals = parsed.data

  // Look up whether pref1 committee uses double-delegation
  const pref1Committee = vals.pref1CommitteeId
    ? await prisma.committee.findUnique({
        where: { id: vals.pref1CommitteeId },
        select: { doubleDelegation: true },
      })
    : null
  const isDoubleDelegation = pref1Committee?.doubleDelegation ?? false

  // Enforce co-delegate requirement for double-delegation committees
  if (isDoubleDelegation && !vals.coDelegate) {
    return { success: false, error: "Co-delegate information is required for this committee." }
  }

  // Duplicate email guard (DB unique index is the hard guard; this gives a friendly error).
  //
  // Scoped to the current event, and that scope is the point: identity is per-event,
  // so somebody who attended a previous conference must be able to register for this
  // one. An unscoped check here would turn them away with "already registered" even
  // though the database would accept the row.
  const activeEvent = await getActiveEvent()
  if (!activeEvent) {
    return { success: false, error: "Registrations are closed." }
  }
  const existing = await prisma.delegate.findFirst({
    where: { email: vals.email, eventId: activeEvent.id },
  })
  if (existing) {
    return { success: false, error: "This email is already registered. Sign in to view your application status." }
  }

  let delegate
  try {
    delegate = await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction, so registration closing while this form was
      // being filled in is caught rather than raced past. Reading the event row is
      // also what makes the check single-sourced: it is the same row that decides
      // whether the site is accepting anyone at all.
      const event = await tx.event.findFirst({
        where: { state: { notIn: [...INACTIVE_STATES] } },
        select: { id: true, registrationOpen: true },
      })
      if (!event || !event.registrationOpen) return null

      return tx.delegate.create({
        data: {
          eventId: event.id,
          fullName: vals.fullName,
          email: vals.email,
          whatsapp: vals.whatsapp,
          altPhone: vals.altPhone ?? null,
          institution: vals.institution,
          isDtu: vals.isDtu,
          munExperience: vals.munExperience || null,
          source: "SELF",
          pref1CommitteeId: vals.pref1CommitteeId,
          pref1Portfolio: vals.pref1Portfolio,
          pref1PortfolioId: await validSeat(tx, vals.pref1PortfolioId, vals.pref1CommitteeId),
          // For double-delegation committees, clear pref2, it is not applicable
          pref2CommitteeId: isDoubleDelegation ? null : (vals.pref2CommitteeId ?? null),
          pref2Portfolio: isDoubleDelegation ? null : (vals.pref2Portfolio ?? null),
          pref2PortfolioId: isDoubleDelegation
            ? null
            : await validSeat(tx, vals.pref2PortfolioId, vals.pref2CommitteeId),
          needsAccommodation: vals.needsAccommodation,
          outsideNcr: vals.outsideNcr,
          reference: vals.reference || null,
          status: "REGISTERED",
          ...(isDoubleDelegation && vals.coDelegate
            ? {
                coDelegate: {
                  create: {
                    fullName: vals.coDelegate.fullName,
                    email: vals.coDelegate.email,
                    phone: vals.coDelegate.phone,
                    institution: vals.coDelegate.institution ?? null,
                    munExperience: vals.coDelegate.munExperience || null,
                  },
                },
              }
            : {}),
        },
      })
    }, { isolationLevel: "Serializable" })
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002") {
      return { success: false, error: "This email is already registered. Sign in to view your application status." }
    }
    throw err
  }

  if (!delegate) {
    return { success: false, error: "Registrations closed while you were submitting. Your application was not created." }
  }

  try {
    await sendRegistrationEmails(delegate.id)
  } catch (err) {
    // Email must never fail the registration, the delegate row is already committed.
    // loggedSend has already written a FAILED EmailLog row (visible in the admin email
    // drawer, resendable from there); this line surfaces it in the server logs so a
    // broken Resend key or address is noticed without someone opening the admin UI.
    console.error(`[register] registration emails failed for delegate ${delegate.id}:`, err)
  }

  return { success: true, delegateId: delegate.id, publicToken: delegate.publicToken }
}

// A preference id arrives from the browser, so it is checked rather than trusted:
// it has to be a real seat, still going, in the committee the delegate actually
// chose. Anything else is dropped to null and the typed name carries the
// preference instead, which is the same path every Google Form import takes.
async function validSeat(
  tx: Prisma.TransactionClient,
  portfolioId: string | undefined,
  committeeId: string | null | undefined,
): Promise<string | null> {
  if (!portfolioId || !committeeId) return null
  const seat = await tx.portfolio.findFirst({
    where: { id: portfolioId, committeeId, status: "AVAILABLE" },
    select: { id: true },
  })
  return seat?.id ?? null
}
