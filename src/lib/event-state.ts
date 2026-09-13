import type { Content } from "@/content/contentSchema"

// What the current event can do.
//
// paymentsRequired used to be `isConference && paymentsEnabled`, which welded
// behaviour to the names in the eventMode enum: an Intra could never charge, and a
// fourth kind of event meant a new branch here and at every caller. Capabilities now
// come from the Event row, which getContent overlays onto Content, so a new sort of
// event is configuration rather than code.
//
// isSociety / isIntra / isConference remain, but only as labels for copy and for the
// DTU-only intake rule below. Nothing about what the platform CHARGES or OPENS may
// branch on them again: add a capability instead.
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
    // No active event leaves this false already: getContent falls back to the
    // society's resting state when it finds none.
    paymentsRequired: content.paymentsEnabled,
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
