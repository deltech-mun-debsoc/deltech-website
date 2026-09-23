import { AccessToken, RoomServiceClient } from "livekit-server-sdk"
import { prisma } from "@/lib/prisma"
import { t } from "@/content/strings"
import type { ChatViewer } from "@/lib/committee/chat"
import { bus } from "@/lib/realtime/bus"
import { LOBBY_SLOTS, lobbyGrants, lobbyRoomName, occupancy, parseRoomName, type LobbySlot, type Occupant, type VisitChange } from "./voice"
import { liveKitConfig } from "./config"
import {
  TOKEN_TTL_SECONDS,
  floorRoomName,
  grantsFor,
  mayPublish,
  parseIdentity,
  participantIdentity,
  permissionChanges,
  publishersFor,
  type FloorSpeakers,
} from "./video"

// The server half of committee video. The database is the truth about who holds
// the floor; LiveKit is brought in line with it. Syncing is best effort: an SFU
// that is down or slow must never stop the chair calling the next speaker, so
// every call here logs and returns rather than throwing, and the room is
// corrected again on the next floor change and on every join.

async function liveSession(committeeId: string) {
  return prisma.committeeSession.findFirst({
    where: { committeeId, state: "ACTIVE" },
    orderBy: { attempt: "desc" },
    select: { id: true },
  })
}

/** Who holds the floor right now, read from the speakers lists. */
export async function floorSpeakers(sessionId: string): Promise<FloorSpeakers> {
  const speaking = await prisma.speakerEntry.findMany({
    where: { sessionId, state: "SPEAKING" },
    select: { portfolioId: true, motionId: true, motion: { select: { state: true, kind: true } } },
  })
  const gsl = speaking.find((s) => s.motionId === null)?.portfolioId ?? null
  const caucus =
    speaking.find((s) => s.motion?.state === "IN_PROGRESS" && s.motion.kind === "MODERATED_CAUCUS")?.portfolioId ?? null
  return { gsl, caucus }
}

export interface FloorToken {
  url: string
  token: string
  room: string
}

/**
 * A token for this viewer's floor room, or null when video is off or no session
 * is open. The grant reflects the floor at this moment; later changes are
 * applied to the live connection by syncFloorRoom.
 */
export async function mintFloorToken(viewer: ChatViewer, committeeId: string): Promise<FloorToken | null> {
  const config = liveKitConfig()
  if (!config) return null
  const session = await liveSession(committeeId)
  if (!session) return null

  const room = floorRoomName(session.id)
  const video = viewer.kind === "dais" ? { kind: "dais" as const, userId: viewer.userId } : { kind: "delegate" as const, userId: viewer.userId, portfolioId: viewer.portfolioId }
  const at = new AccessToken(config.apiKey, config.apiSecret, {
    identity: participantIdentity(video),
    // The name other participants see, set by the server. Grants forbid changing it.
    name: viewer.kind === "dais" ? t("committeeChat.daisLabel") : viewer.portfolioName,
    ttl: TOKEN_TTL_SECONDS,
  })
  at.addGrant(grantsFor(video, room, publishersFor(await floorSpeakers(session.id))))
  return { url: config.url, token: await at.toJwt(), room }
}

function client() {
  const config = liveKitConfig()
  return config ? new RoomServiceClient(config.httpUrl, config.apiKey, config.apiSecret) : null
}

/**
 * Bring a committee's floor room in line with the floor: grant the current
 * speakers, revoke everyone else. Revoking also unpublishes their tracks, so a
 * delegate whose time is up goes quiet at once.
 */
export async function syncFloorRoom(committeeId: string): Promise<void> {
  const rooms = client()
  if (!rooms) return
  try {
    const session = await liveSession(committeeId)
    if (!session) return
    const room = floorRoomName(session.id)
    let participants
    try {
      participants = await rooms.listParticipants(room)
    } catch {
      return // No room yet: nobody has joined, so there is nothing to correct.
    }
    const changes = permissionChanges(
      participants.map((p) => ({ identity: p.identity, canPublish: !!p.permission?.canPublish })),
      publishersFor(await floorSpeakers(session.id)),
    )
    await Promise.all(
      changes.map((c) =>
        rooms
          .updateParticipant(room, c.identity, {
            permission: { canPublish: c.canPublish, canSubscribe: true, canPublishData: false, canUpdateMetadata: false },
          })
          .catch((err) => console.error("[livekit] permission update failed", c.identity, err)),
      ),
    )
  } catch (err) {
    console.error("[livekit] floor sync failed", committeeId, err)
  }
}

/**
 * Correct one participant as they join. Their token carried the floor as it was
 * when minted, which may be stale by the time they connect.
 */
export async function syncJoiningParticipant(room: string, identity: string): Promise<void> {
  const rooms = client()
  if (!rooms) return
  try {
    const parsed = parseRoomName(room)
    if (!parsed) return
    const session = await prisma.committeeSession.findUnique({ where: { id: parsed.sessionId }, select: { id: true, state: true } })
    // A participant this app did not mint, or a room for a session that is not
    // live, is removed rather than corrected.
    if (!session || session.state !== "ACTIVE" || !parseIdentity(identity)) {
      await rooms.removeParticipant(room, identity).catch(() => {})
      return
    }
    // A lobby token already fixes what can be published (the microphone), so
    // there is nothing to restate there; only the floor follows the speakers list.
    if (parsed.kind === "lobby") return
    // Always state the permission on join rather than diffing: what the token
    // granted is only knowable by trusting the client.
    await rooms.updateParticipant(room, identity, {
      permission: {
        canPublish: mayPublish(identity, publishersFor(await floorSpeakers(session.id))),
        canSubscribe: true,
        canPublishData: false,
        canUpdateMetadata: false,
      },
    })
  } catch (err) {
    console.error("[livekit] join sync failed", room, identity, err)
  }
}

// ---------------------------------------------------------------------------
// Lobbying voice channels
// ---------------------------------------------------------------------------

export interface VoiceTokens {
  url: string
  floor: { room: string; token: string }
  lobbies: { slot: LobbySlot; name: string; room: string; token: string }[]
}

/**
 * Every token this viewer needs for the committee, minted at once. Switching
 * channel then costs no round trip to this server: the browser already holds the
 * token for wherever it is going. Only this committee's channels are included, so
 * the tokens themselves are the boundary.
 */
export async function mintVoiceTokens(viewer: ChatViewer, committeeId: string): Promise<VoiceTokens | null> {
  const floor = await mintFloorToken(viewer, committeeId)
  const config = liveKitConfig()
  if (!floor || !config) return null
  const session = await liveSession(committeeId)
  if (!session) return null

  const identity = participantIdentity(
    viewer.kind === "dais"
      ? { kind: "dais", userId: viewer.userId }
      : { kind: "delegate", userId: viewer.userId, portfolioId: viewer.portfolioId },
  )
  const name = viewer.kind === "dais" ? t("committeeChat.daisLabel") : viewer.portfolioName
  const lobbies = await Promise.all(
    LOBBY_SLOTS.map(async (slot) => {
      const room = lobbyRoomName(session.id, slot)
      const at = new AccessToken(config.apiKey, config.apiSecret, { identity, name, ttl: TOKEN_TTL_SECONDS })
      at.addGrant(lobbyGrants(room))
      return { slot, name: t("voice.lobby", { n: slot }), room, token: await at.toJwt() }
    }),
  )
  return { url: config.url, floor: { room: floor.room, token: floor.token }, lobbies }
}

// Occupancy is read from LiveKit, not from the visit table, so a lost webhook
// can never leave a ghost in a channel. Cached briefly per committee, and
// concurrent readers share one fetch: 45 screens refreshing on the same nudge
// cost six LiveKit calls, not 270. One app container per environment, so a
// process-local cache is the whole cache.
const OCCUPANCY_TTL_MS = 1500
const occupancyCache = new Map<string, { at: number; value: Promise<Record<number, Occupant[]>> }>()

export async function lobbyOccupancy(committeeId: string): Promise<Record<number, Occupant[]> | null> {
  const rooms = client()
  if (!rooms) return null
  const hit = occupancyCache.get(committeeId)
  if (hit && Date.now() - hit.at < OCCUPANCY_TTL_MS) return hit.value

  const value = (async () => {
    const session = await liveSession(committeeId)
    if (!session) return occupancy([])
    const lists = await Promise.all(
      LOBBY_SLOTS.map(async (slot) => ({
        slot,
        // A room nobody has joined does not exist yet; that is an empty channel.
        participants: await rooms.listParticipants(lobbyRoomName(session.id, slot)).catch(() => []),
      })),
    )
    return occupancy(lists)
  })()
  occupancyCache.set(committeeId, { at: Date.now(), value })
  // A failed read must not be cached for the next reader.
  value.catch(() => occupancyCache.delete(committeeId))
  return value
}

/**
 * Record a lobby join or leave, and tell the committee's screens to refresh the
 * channel list. Keyed on LiveKit's participant sid: a retried webhook rewrites the
 * same row, and a leave that arrives before its join still lands on one row.
 */
export async function recordVisit(change: VisitChange): Promise<void> {
  const session = await prisma.committeeSession.findUnique({
    where: { id: change.sessionId },
    select: { committeeId: true },
  })
  if (!session) return
  const base = {
    committeeId: session.committeeId,
    sessionId: change.sessionId,
    room: change.room,
    slot: change.slot,
    portfolioId: change.portfolioId,
    identity: change.identity,
    participantSid: change.participantSid,
  }
  const stamp = change.kind === "join" ? { joinedAt: change.at } : { leftAt: change.at }
  await prisma.voiceChannelVisit.upsert({
    where: { participantSid: change.participantSid },
    create: { ...base, ...stamp },
    update: stamp,
  })
  occupancyCache.delete(session.committeeId)
  bus.publish(`committee:${session.committeeId}`, "voice", null)
}

function sessionRooms(sessionId: string): string[] {
  return [floorRoomName(sessionId), ...LOBBY_SLOTS.map((slot) => lobbyRoomName(sessionId, slot))]
}

/**
 * End a closed session's rooms, disconnecting everyone in them. Tokens outlive
 * the session, so without this a delegate already connected stays in a room the
 * secretariat has closed.
 */
export async function closeSessionRooms(sessionId: string): Promise<void> {
  const rooms = client()
  if (!rooms) return
  await Promise.all(sessionRooms(sessionId).map((room) => rooms.deleteRoom(room).catch(() => {})))
}

/**
 * Take one person out of a committee's live rooms, e.g. a chair the secretariat
 * has just removed. Their pre-minted tokens stay valid until they expire, so
 * declining to mint more is not enough; syncJoiningParticipant does not help
 * either, because it checks the session, not the person.
 */
export async function removeFromCommitteeRooms(committeeId: string, identity: string): Promise<void> {
  const rooms = client()
  if (!rooms) return
  const session = await liveSession(committeeId)
  if (!session) return
  await Promise.all(sessionRooms(session.id).map((room) => rooms.removeParticipant(room, identity).catch(() => {})))
}
