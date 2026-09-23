import { AccessToken, RoomServiceClient } from "livekit-server-sdk"
import { prisma } from "@/lib/prisma"
import { t } from "@/content/strings"
import type { ChatViewer } from "@/lib/committee/chat"
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
    const match = /^floor_([A-Za-z0-9_-]{1,40})$/.exec(room)
    if (!match) return
    const session = await prisma.committeeSession.findUnique({ where: { id: match[1] }, select: { id: true, state: true } })
    // A participant this app did not mint, or a room for a session that is not
    // live, is removed rather than corrected.
    if (!session || session.state !== "ACTIVE" || !parseIdentity(identity)) {
      await rooms.removeParticipant(room, identity).catch(() => {})
      return
    }
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
