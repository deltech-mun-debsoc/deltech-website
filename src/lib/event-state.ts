import type { Content } from "@/content/contentSchema"

export function deriveEventState(content: Content) {
  const isSociety = content.eventMode === "SOCIETY"
  const isIntra = content.eventMode === "INTRA_MUN"
  const isConference = content.eventMode === "CONFERENCE"

  return {
    isSociety,
    isIntra,
    isConference,
    showEventHero:
      !isSociety &&
      content.publicSections.activeEvent &&
      content.activeEventName.trim().length > 0,
    acceptsRegistrations: !isSociety && content.registrationOpen,
    paymentsRequired: isConference && content.paymentsEnabled,
  }
}

// May an AUTOMATIC intake path create a delegate right now?
//
// Three paths create delegates without a person reviewing each one: the Google
// Form webhook, the daily partner-sheet pull, and the cross-delegation import
// wizard. Each used to decide for itself, and none checked the event: a form left
// open kept admitting delegates after registration closed, and during a DTU-only
// Intra MUN the cross-delegation paths would still mark outsiders CONFIRMED and
// auto-allot them seats. One rule, one place, every path asks it.
//
// The Google Form responses screen is deliberately NOT gated: an organiser
// pressing Import is the review.
export function automaticIntakeAllowed(
  content: Content,
  source: "SELF" | "CROSS_DEL",
): { ok: true } | { ok: false; reason: string } {
  const state = deriveEventState(content)
  if (!state.acceptsRegistrations) {
    return { ok: false, reason: "Registration is closed, so this was not admitted automatically." }
  }
  if (state.isIntra && source === "CROSS_DEL") {
    return {
      ok: false,
      reason: "The Intra MUN is for DTU students only, so cross-delegation intake is switched off.",
    }
  }
  return { ok: true }
}
