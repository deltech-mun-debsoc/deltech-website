import { NextResponse } from "next/server"
import { resolveCommitteeViewer } from "@/lib/committee/viewer"
import { parseId } from "@/lib/committee/chat"
import { lobbyOccupancy } from "@/lib/livekit/server"

// Who is in which lobbying channel. Visible to the committee's own delegates and
// the dais, the same boundary as chat and the floor: the dais's view of the
// channels is the delegates' sidebar, which is what makes caucusing visible.
export async function GET(_request: Request, { params }: { params: Promise<{ committeeId: string }> }) {
  const committeeId = parseId((await params).committeeId)
  const viewer = committeeId ? await resolveCommitteeViewer(committeeId) : null
  if (!committeeId || !viewer) return NextResponse.json({ error: "Not found." }, { status: 404 })
  const channels = await lobbyOccupancy(committeeId)
  return NextResponse.json({ enabled: channels !== null, channels: channels ?? {} }, { headers: { "Cache-Control": "no-store" } })
}
