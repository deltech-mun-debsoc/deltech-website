import { NextResponse } from "next/server"
import { resolveCommitteeViewer } from "@/lib/committee/viewer"
import { readFloor } from "@/lib/committee/floor-server"
import { parseId } from "@/lib/committee/chat"

// The floor as this account may see it. The realtime channel only says "fetch
// again"; this is where a delegate's view is decided, including that a vote's
// running count and other delegations' ballots stay hidden until it closes.
export async function GET(_request: Request, { params }: { params: Promise<{ committeeId: string }> }) {
  const committeeId = parseId((await params).committeeId)
  const viewer = committeeId ? await resolveCommitteeViewer(committeeId) : null
  if (!committeeId || !viewer) return NextResponse.json({ error: "Not found." }, { status: 404 })
  return NextResponse.json(await readFloor(viewer, committeeId), { headers: { "Cache-Control": "no-store" } })
}
