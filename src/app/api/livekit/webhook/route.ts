import { NextResponse } from "next/server"
import { liveKitConfig } from "@/lib/livekit/config"
import { verifyWebhook } from "@/lib/livekit/webhook"
import { recordVisit, syncJoiningParticipant } from "@/lib/livekit/server"
import { visitFromWebhook } from "@/lib/livekit/voice"

// LiveKit calls this on room events. It is open to the internet, so the signature
// is the only thing that makes a request LiveKit's. Handling is idempotent:
// LiveKit retries, a replayed join only restates a permission, and visits are
// keyed on the participant sid.
export async function POST(request: Request) {
  const config = liveKitConfig()
  if (!config) return NextResponse.json({ error: "Not found." }, { status: 404 })

  const event = await verifyWebhook(config, await request.text(), request.headers.get("authorization"))
  if (!event) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

  const room = event.room?.name ?? ""
  const identity = event.participant?.identity ?? ""
  if (event.event === "participant_joined" && room && identity) {
    await syncJoiningParticipant(room, identity)
  }
  const change = visitFromWebhook({
    event: event.event,
    room,
    participantSid: event.participant?.sid ?? "",
    identity,
    // LiveKit's own event time, so an out-of-order delivery still records when
    // it happened rather than when it arrived.
    at: event.createdAt ? new Date(Number(event.createdAt) * 1000) : new Date(),
  })
  if (change) await recordVisit(change)
  return NextResponse.json({ ok: true })
}
