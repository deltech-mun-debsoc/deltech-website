import { NextRequest, NextResponse } from "next/server"
import { processMailQueue } from "@/lib/mailer/queue"

// Ticked every two minutes by deploy/mailer-tick.sh on each box, and safe to
// call more often: every campaign and recipient is claimed before it is acted
// on, so overlapping runs cannot send anything twice.
export async function GET(req: NextRequest) {
  // Fail closed: an unset secret must not leave a mail-sending endpoint open.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.json(await processMailQueue())
}
