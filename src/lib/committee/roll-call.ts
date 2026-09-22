// Roll call and quorum. Pure: no Prisma, no React, so
// scripts/check-committee-roll-call.ts can exercise every edge without a database.
//
// Lifecycle decisions (start / pause / resume / finish, elapsed time, version
// conflicts) are NOT here: a committee session is the same state machine as a
// recruitment session and reuses src/lib/session.ts rather than copying it.

export type CommitteeAttendanceName =
  | "EXPECTED"
  | "PRESENT"
  | "PRESENT_AND_VOTING"
  | "ABSENT"
  | "LATE"

// The fraction of the committee that must be present for debate to open. UN
// rules of procedure say one third; conferences vary, so it is a parameter
// rather than a constant hidden in a comparison.
export const DEFAULT_QUORUM_FRACTION = 1 / 3

// LATE is a present delegation that arrived after roll call was taken. It is
// counted present because it is in the room; the distinction exists so a chair
// can see who missed the opening, not to exclude them from quorum.
export function isPresent(status: CommitteeAttendanceName): boolean {
  return status === "PRESENT" || status === "PRESENT_AND_VOTING" || status === "LATE"
}

// A delegation that declared itself present and voting has given up the right to
// abstain on a substantive vote. This is the whole reason the two states are
// distinct, so the rule lives next to the enum rather than in the voting screen.
export function mayAbstain(status: CommitteeAttendanceName): boolean {
  return status === "PRESENT" || status === "LATE"
}

export interface AttendanceTally {
  /** Every seat in the committee, including those never marked. */
  total: number
  expected: number
  present: number
  presentAndVoting: number
  absent: number
  late: number
  /** Present by any route: the quorum numerator. */
  inRoom: number
}

export function tally(rows: readonly CommitteeAttendanceName[]): AttendanceTally {
  const t: AttendanceTally = {
    total: rows.length,
    expected: 0,
    present: 0,
    presentAndVoting: 0,
    absent: 0,
    late: 0,
    inRoom: 0,
  }
  for (const r of rows) {
    if (r === "EXPECTED") t.expected++
    else if (r === "PRESENT") t.present++
    else if (r === "PRESENT_AND_VOTING") t.presentAndVoting++
    else if (r === "ABSENT") t.absent++
    else if (r === "LATE") t.late++
    if (isPresent(r)) t.inRoom++
  }
  return t
}

// Seats that may cast a vote at all. Distinct from `inRoom` only because a future
// rule could exclude observers; today every present delegation may vote.
export function votingStrength(t: AttendanceTally): number {
  return t.inRoom
}

// Strictly greater than the threshold, not equal: with 30 seats and a one-third
// rule, 10 present is exactly one third and is NOT quorum. Conferences that want
// "at least one third" should pass a fraction just below.
export function hasQuorum(t: AttendanceTally, fraction = DEFAULT_QUORUM_FRACTION): boolean {
  if (t.total === 0) return false
  return t.inRoom > t.total * fraction
}

// How many more seats must arrive before debate can open. Zero once quorum is
// met. Useful to the chair as a countdown during roll call.
export function seatsShortOfQuorum(
  t: AttendanceTally,
  fraction = DEFAULT_QUORUM_FRACTION,
): number {
  // Derived from hasQuorum rather than recomputing the threshold, so the two can
  // never disagree. An empty committee reports 1 rather than 0: it has no quorum,
  // and "short by zero" would read as though it did.
  if (hasQuorum(t, fraction)) return 0
  const needed = Math.floor(t.total * fraction) + 1
  return Math.max(1, needed - t.inRoom)
}
