import { NextResponse } from "next/server"
import { resolveCommitteeViewer } from "@/lib/committee/viewer"
import { parseId } from "@/lib/committee/chat"
import { mintVoiceTokens } from "@/lib/livekit/server"

// Every token this viewer needs for the committee's rooms, in one response: the
// floor, and each lobbying channel. POST and no-store: tokens are credentials and
// must never sit in a cache or be fetched by a prefetch. The same viewer check as
// chat and the floor decides who gets any, and only this committee's rooms are
// included, so a delegate never holds a token for anyone else's caucus.
export async function POST(_request: Request, { params }: { params: Promise<{ committeeId: string }> }) {
  const committeeId = parseId((await params).committeeId)
  const viewer = committeeId ? await resolveCommitteeViewer(committeeId) : null
  if (!committeeId || !viewer) return NextResponse.json({ error: "Not found." }, { status: 404 })

  const tokens = await mintVoiceTokens(viewer, committeeId)
  // Video switched off, or no session open: say so plainly, and the page hides it.
  const body = tokens ? { enabled: true, ...tokens } : { enabled: false }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } })
}
