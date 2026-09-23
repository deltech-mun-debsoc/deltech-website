import { TrackSource } from "livekit-server-sdk"
import { parseIdentity } from "./video"

// Lobbying voice channels. Server-side only: this imports the server SDK, so the
// browser gets room names and labels from the token response instead.
//
// Every committee session has the same fixed set of channels, like a Discord
// server's voice channels: always listed, joinable in one click, no creating,
// naming or inviting. A fixed set is what makes switching fast (every token can
// be minted up front) and what makes the dais's view free (it is the same list).
//
// Channels are audio only, and LiveKit enforces it: a lobby token may publish
// from the microphone and nothing else. Audio is ~50 kbps against ~2.4 Mbps for
// video, and lobbying is most of a conference's traffic (the plan's section 1).

export const LOBBY_SLOTS = [1, 2, 3, 4, 5, 6] as const
export type LobbySlot = (typeof LOBBY_SLOTS)[number]

export function lobbyRoomName(sessionId: string, slot: LobbySlot): string {
  return `lobby_${sessionId}_${slot}`
}

export type ParsedRoom = { kind: "floor"; sessionId: string } | { kind: "lobby"; sessionId: string; slot: LobbySlot }

const FLOOR = /^floor_([A-Za-z0-9_-]{1,40})$/
const LOBBY = /^lobby_([A-Za-z0-9-]{1,40})_([1-6])$/

export function parseRoomName(room: string): ParsedRoom | null {
  const l = LOBBY.exec(room)
  if (l) return { kind: "lobby", sessionId: l[1], slot: Number(l[2]) as LobbySlot }
  const f = FLOOR.exec(room)
  if (f) return { kind: "floor", sessionId: f[1] }
  return null
}

export function lobbyGrants(room: string) {
  return {
    room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    // Microphone only. Enforced by the SFU: a camera or screen track is refused.
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: false,
    canUpdateOwnMetadata: false,
  }
}

export interface VisitEvent {
  event: string
  room: string
  participantSid: string
  identity: string
  at: Date
}

export type VisitChange =
  | { kind: "join"; sessionId: string; slot: LobbySlot; room: string; participantSid: string; identity: string; portfolioId: string | null; at: Date }
  | { kind: "leave"; sessionId: string; slot: LobbySlot; room: string; participantSid: string; identity: string; portfolioId: string | null; at: Date }

/**
 * What a LiveKit webhook means for the visit record, or null if it is not about
 * a lobby, or about an identity this app did not mint.
 */
export function visitFromWebhook(e: VisitEvent): VisitChange | null {
  const kind = e.event === "participant_joined" ? "join" : e.event === "participant_left" ? "leave" : null
  if (!kind || !e.participantSid) return null
  const room = parseRoomName(e.room)
  if (room?.kind !== "lobby") return null
  const who = parseIdentity(e.identity)
  if (!who) return null
  return {
    kind,
    sessionId: room.sessionId,
    slot: room.slot,
    room: e.room,
    participantSid: e.participantSid,
    identity: e.identity,
    portfolioId: who.kind === "seat" ? who.portfolioId : null,
    at: e.at,
  }
}

export interface Occupant {
  identity: string
  name: string
  dais: boolean
}

/** Who is in each channel, from LiveKit's participant lists. Unknown identities are not shown. */
export function occupancy(rooms: readonly { slot: LobbySlot; participants: readonly { identity: string; name: string }[] }[]) {
  const out: Record<number, Occupant[]> = {}
  for (const slot of LOBBY_SLOTS) out[slot] = []
  for (const r of rooms) {
    for (const p of r.participants) {
      const who = parseIdentity(p.identity)
      if (!who) continue
      out[r.slot].push({ identity: p.identity, name: p.name || p.identity, dais: who.kind === "dais" })
    }
  }
  return out
}
