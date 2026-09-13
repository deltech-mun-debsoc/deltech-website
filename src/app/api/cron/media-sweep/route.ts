import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ORPHAN_AFTER_MS } from "@/lib/media/keys"
import { MediaNotConfigured, deleteObject } from "@/lib/media/s3"

// Orphaned-upload cleanup (GitHub Actions cron). An upload that got a presigned URL but
// never finalised leaves a PENDING row: the browser closed, the network dropped, the
// user changed their mind. After ORPHAN_AFTER_MS those rows are swept: the object is
// deleted if it exists, and the row is marked FAILED rather than removed, so the
// history of a failed upload survives.
//
// Also clears the object for rows already marked FAILED, in case finalisation failed
// after the bytes landed.

export async function GET(req: NextRequest) {
  // Fail closed: no configured secret means no access (never world-callable).
  const authHeader = req.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - ORPHAN_AFTER_MS)

  const orphans = await prisma.mediaAsset.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      createdAt: { lt: cutoff },
      deletedAt: null,
    },
    // Bounded so one run cannot time out on a large backlog; the next run continues.
    take: 200,
    select: { id: true, objectKey: true, status: true },
  })

  let deleted = 0
  let failed = 0

  for (const asset of orphans) {
    try {
      await deleteObject(asset.objectKey)
      await prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: "FAILED",
          deletedAt: new Date(),
          publicUrl: null,
          error: asset.status === "PENDING" ? "Abandoned before finalisation; swept." : "Swept after failure.",
        },
      })
      deleted++
    } catch (err) {
      if (err instanceof MediaNotConfigured) {
        // Nothing to sweep without credentials; report rather than 500 the cron.
        return NextResponse.json({ ok: true, skipped: "s3-not-configured" })
      }
      // Leave the row for the next run rather than marking it clean.
      console.error("[cron/media-sweep]", asset.objectKey, err)
      failed++
    }
  }

  return NextResponse.json({ ok: true, examined: orphans.length, deleted, failed })
}
