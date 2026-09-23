import { NextResponse } from "next/server"
import { resolveCommitteeViewer } from "@/lib/committee/viewer"
import { parseId } from "@/lib/committee/chat"
import { mintFloorToken } from "@/lib/livekit/server"

// A token for this committee's floor room. POST and no-store: a token is a
// credential, and must never sit in a cache or be fetched by a prefetch. The same
// viewer check as chat and the floor decides who gets one, and what it may do is
// decided from the floor at this moment (src/lib/livekit/video.ts).
export async function POST(_request: Request, { params }: { params: Promise<{ committeeId: string }> }) {
  const committeeId = parseId((await params).committeeId)
  const viewer = committeeId ? await resolveCommitteeViewer(committeeId) : null
  if (!committeeId || !viewer) return NextResponse.json({ error: "Not found." }, { status: 404 })

  const token = await mintFloorToken(viewer, committeeId)
  // Video switched off, or no session open: say so plainly, and the page hides video.
  const body = token ? { enabled: true, ...token } : { enabled: false }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } })
}
