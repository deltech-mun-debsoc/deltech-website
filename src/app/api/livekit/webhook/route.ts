import { NextResponse } from "next/server"
import { liveKitConfig } from "@/lib/livekit/config"
import { verifyWebhook } from "@/lib/livekit/webhook"
import { syncJoiningParticipant } from "@/lib/livekit/server"

// LiveKit calls this on room events. It is open to the internet, so the signature
// is the only thing that makes a request LiveKit's. Handling is idempotent:
// LiveKit retries, and a replayed join only restates a permission.
export async function POST(request: Request) {
  const config = liveKitConfig()
  if (!config) return NextResponse.json({ error: "Not found." }, { status: 404 })

  const event = await verifyWebhook(config, await request.text(), request.headers.get("authorization"))
  if (!event) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

  if (event.event === "participant_joined" && event.room?.name && event.participant?.identity) {
    await syncJoiningParticipant(event.room.name, event.participant.identity)
  }
  return NextResponse.json({ ok: true })
}
