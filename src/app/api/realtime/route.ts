import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { STAFF_ROLES } from "@/lib/authz"
import { bus, type PresenceMeta } from "@/lib/realtime/bus"
import { canPublish, canSubscribe, channelName, parseChannel, type Viewer } from "@/lib/realtime/channels"

// Server-Sent Events in place of Supabase realtime.
//
// GET  opens the stream for one channel; POST publishes to it (staff only).
// A heartbeat every 25s keeps proxies and phone radios from dropping an idle
// connection, and EventSource reconnects on its own if one dies anyway.

const HEARTBEAT_MS = 25_000

async function viewer(): Promise<Viewer> {
  const session = await auth()
  const role = (session?.user as { role?: string } | undefined)?.role
  return { staff: !!role && STAFF_ROLES.has(role), authenticated: !!role }
}

export async function GET(request: NextRequest) {
  const ref = parseChannel(request.nextUrl.searchParams.get("channel") ?? "")
  if (!ref) return NextResponse.json({ error: "Unknown channel." }, { status: 400 })
  if (!canSubscribe(ref, await viewer())) {
    return NextResponse.json({ error: "Not allowed on this channel." }, { status: 403 })
  }

  const params = request.nextUrl.searchParams
  const nickname = params.get("nickname")?.slice(0, 40)
  const userId = params.get("userId")?.slice(0, 64)
  const presence: PresenceMeta | null =
    nickname && userId ? { nickname, avatar: params.get("avatar")?.slice(0, 40) ?? "", userId } : null

  const channel = channelName(ref)
  const encoder = new TextEncoder()
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let unsubscribe: (() => void) | undefined

  const stream = new ReadableStream({
    start(controller) {
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk))
      const send = (event: string, data: unknown) =>
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

      unsubscribe = bus.subscribe({
        id: crypto.randomUUID(),
        channel,
        presence,
        send,
      })

      send("ready", { channel })
      // A late joiner needs the room's current roster, not just future changes.
      send("presence", bus.presence(channel))
      heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS)
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat)
      unsubscribe?.()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform stops any proxy buffering the stream into silence.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

export async function POST(request: NextRequest) {
  let body: { channel?: string; event?: string; payload?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 })
  }

  const ref = parseChannel(body.channel ?? "")
  if (!ref || !body.event) return NextResponse.json({ error: "Unknown channel." }, { status: 400 })
  // Publishing is staff-only: on Supabase any participant holding the room code
  // could push a fake leaderboard to the projector.
  if (!canPublish(ref, await viewer())) {
    return NextResponse.json({ error: "Not allowed to publish." }, { status: 403 })
  }

  const delivered = bus.publish(channelName(ref), body.event, body.payload ?? null)
  return NextResponse.json({ delivered })
}
