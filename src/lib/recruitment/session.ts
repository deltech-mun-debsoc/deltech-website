// Session timing and lifecycle decisions moved to src/lib/session.ts when online
// committees became a second consumer: the logic never mentioned recruitment, and
// two copies of a state machine drift.
//
// This re-export keeps the thirteen existing recruitment imports working
// unchanged. CONTROL_LEASE_MS and nextControlExpiry stay in the shared module
// because recruitment still writes controlExpiresAt, even though nothing gates on
// it any more (see the note there).
export * from "../session"
