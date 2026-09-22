import { NextRequest, NextResponse } from "next/server"
import { resolveCommitteeViewer } from "@/lib/committee/viewer"
import { readCommitteeMessages } from "@/lib/committee/messages"

// The only way a browser reads committee chat. Every call resolves the viewer
// from the session and filters on the server, so what comes back is exactly what
// this account may see. The realtime channel only says "fetch again".

const ID = /^[A-Za-z0-9_-]{1,40}$/

function parseSince(raw: string | null): number | null {
  if (raw === null) return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ committeeId: string }> },
) {
  const { committeeId } = await params
  // Not found rather than forbidden, so the endpoint does not confirm which
  // committee ids exist to someone outside them.
  if (!ID.test(committeeId)) return NextResponse.json({ error: "Not found." }, { status: 404 })

  const viewer = await resolveCommitteeViewer(committeeId)
  if (!viewer) return NextResponse.json({ error: "Not found." }, { status: 404 })

  const search = request.nextUrl.searchParams
  const page = await readCommitteeMessages(
    viewer,
    committeeId,
    parseSince(search.get("since")),
    search.get("mod")?.slice(0, 40) ?? null,
  )
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } })
}
