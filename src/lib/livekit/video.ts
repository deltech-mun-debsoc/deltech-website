// Who may be seen and heard in a committee's floor room. Pure: no SDK, no
// Prisma, so scripts/check-livekit-video.ts pins every rule.
//
// The rule: the dais may always publish; a delegation may publish only while it
// holds the floor, meaning it is the current speaker on the General Speakers'
// List or on the moderated caucus under way. Everyone may subscribe. This is
// what keeps a 45-seat room to a couple of video streams (see the plan's
// capacity section), and it is enforced by LiveKit on the server, not by hiding
// a button: a delegate's token cannot publish unless the server grants it.

export type VideoViewer =
  | { kind: "dais"; userId: string }
  | { kind: "delegate"; userId: string; portfolioId: string }

export type ParsedIdentity = { kind: "dais"; userId: string } | { kind: "seat"; portfolioId: string; userId: string }

// Tokens outlive a page load comfortably but not a conference day. Permissions
// are adjusted on the live connection, so a long token does not freeze them.
export const TOKEN_TTL_SECONDS = 4 * 60 * 60

export function floorRoomName(sessionId: string): string {
  return `floor_${sessionId}`
}

/**
 * One identity per person, never per seat. A double delegation is two people on
 * one seat, and LiveKit disconnects the earlier participant when a second joins
 * under the same identity. Rights are decided per seat (see mayPublish).
 */
export function participantIdentity(v: VideoViewer): string {
  return v.kind === "dais" ? `dais:${v.userId}` : `seat:${v.portfolioId}:${v.userId}`
}

const PART = "[A-Za-z0-9_-]{1,64}"
const DAIS = new RegExp(`^dais:(${PART})$`)
const SEAT = new RegExp(`^seat:(${PART}):(${PART})$`)

export function parseIdentity(identity: string): ParsedIdentity | null {
  const d = DAIS.exec(identity)
  if (d) return { kind: "dais", userId: d[1] }
  const s = SEAT.exec(identity)
  if (s) return { kind: "seat", portfolioId: s[1], userId: s[2] }
  return null
}

export interface FloorSpeakers {
  /** Portfolio currently speaking on the GSL, if any. */
  gsl: string | null
  /** Portfolio currently speaking in the moderated caucus under way, if any. */
  caucus: string | null
}

export function publishersFor(f: FloorSpeakers): ReadonlySet<string> {
  const s = new Set<string>()
  if (f.gsl) s.add(f.gsl)
  if (f.caucus) s.add(f.caucus)
  return s
}

/** Unknown identities never publish: a participant this app did not mint is refused. */
export function mayPublish(identity: string, publishers: ReadonlySet<string>): boolean {
  const p = parseIdentity(identity)
  if (!p) return false
  return p.kind === "dais" || publishers.has(p.portfolioId)
}

export interface Grants {
  room: string
  roomJoin: true
  canSubscribe: true
  canPublish: boolean
  // Data messages would be an unmoderated side channel next to committee chat,
  // and metadata would let a client rename itself on the dais's screen.
  canPublishData: false
  canUpdateOwnMetadata: false
}

export function grantsFor(v: VideoViewer, room: string, publishers: ReadonlySet<string>): Grants {
  return {
    room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: mayPublish(participantIdentity(v), publishers),
    canPublishData: false,
    canUpdateOwnMetadata: false,
  }
}

export interface LiveParticipant {
  identity: string
  canPublish: boolean
}

/** The permission changes that bring a room in line with the floor. Only real changes. */
export function permissionChanges(
  participants: readonly LiveParticipant[],
  publishers: ReadonlySet<string>,
): { identity: string; canPublish: boolean }[] {
  const out: { identity: string; canPublish: boolean }[] = []
  for (const p of participants) {
    const want = mayPublish(p.identity, publishers)
    if (want !== p.canPublish) out.push({ identity: p.identity, canPublish: want })
  }
  return out
}
