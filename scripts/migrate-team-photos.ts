#!/usr/bin/env tsx
// Move team photos out of Postgres and into S3.
//
//   npx tsx scripts/migrate-team-photos.ts            # dry run, changes nothing
//   npx tsx scripts/migrate-team-photos.ts --apply
//
// Member.photoBytes held each photo as bytes in the database: ~25 MB of images
// in every dump and every backup, a function call and a database read per view,
// and it grows with the society. They are public images, so they belong in the
// bucket. Uploads have already moved (api/admin/team/[id]/photo); this is the
// backlog.
//
// Safe to re-run: a member whose bytes are already gone is skipped, and the
// bytes are only cleared after the object is confirmed readable in the bucket.
import { randomBytes } from "node:crypto"
import { prisma } from "../src/lib/prisma"
import { putObject, requireS3Config, headObject } from "../src/lib/media/s3"
import { publicUrlFor } from "../src/lib/media/keys"
import { teamPhotoKey } from "../src/lib/media/team-photo"

const apply = process.argv.includes("--apply")

async function main(): Promise<void> {
  const config = requireS3Config()
  const members = await prisma.member.findMany({
    where: { photoBytes: { not: null } },
    select: { id: true, name: true, photoBytes: true, photoMimeType: true },
    orderBy: { name: "asc" },
  })

  if (members.length === 0) {
    console.log("Nothing to move: no member still has photo bytes in the database.")
    return
  }

  const totalBytes = members.reduce((sum, m) => sum + (m.photoBytes?.byteLength ?? 0), 0)
  console.log(
    `${members.length} photos, ${(totalBytes / 1024 / 1024).toFixed(1)} MB, into ${config.bucket}` +
      (apply ? "" : "  [DRY RUN: pass --apply to write]"),
  )

  let moved = 0
  let skipped = 0

  for (const member of members) {
    const mime = member.photoMimeType ?? "image/webp"
    const key = teamPhotoKey(member.id, mime, randomBytes(8).toString("hex"))
    if (!key || !member.photoBytes) {
      console.log(`  SKIP  ${member.name}: unsupported type ${mime}`)
      skipped++
      continue
    }

    const size = (member.photoBytes.byteLength / 1024).toFixed(0)
    if (!apply) {
      console.log(`  would move  ${member.name.padEnd(28)} ${size.padStart(4)} KB -> ${key}`)
      continue
    }

    await putObject(key, new Uint8Array(member.photoBytes), mime)

    // Confirm the object is really there before dropping the only other copy.
    const head = await headObject(key)
    if (!head.exists) {
      throw new Error(`Uploaded ${key} for ${member.name} but the bucket does not have it; stopping.`)
    }

    await prisma.member.update({
      where: { id: member.id },
      data: { imageUrl: publicUrlFor(key, config), photoBytes: null, photoMimeType: null },
    })
    console.log(`  moved  ${member.name.padEnd(28)} ${size.padStart(4)} KB -> ${key}`)
    moved++
  }

  if (apply) {
    const left = await prisma.member.count({ where: { photoBytes: { not: null } } })
    console.log(`\nMoved ${moved}, skipped ${skipped}, still in the database: ${left}`)
    console.log("Run VACUUM FULL on the Member table to reclaim the space if the dump is still large.")
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
