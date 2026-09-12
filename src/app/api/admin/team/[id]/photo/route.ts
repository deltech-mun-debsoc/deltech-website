import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { audit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import { MediaNotConfigured, putObject, requireS3Config } from "@/lib/media/s3"
import { publicUrlFor } from "@/lib/media/keys"
import { teamPhotoKey } from "@/lib/media/team-photo"

const MAX_TEAM_PHOTO_BYTES = 750 * 1024
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

// Photos go to S3, not into the database. The browser sends the cropped image
// here (already under 750 KB), this uploads it and stores the URL on the member.
// Member.photoBytes is the old path: it is cleared on every upload, so the
// database stops carrying image bytes in every dump.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user?.email || (role !== "ADMIN" && role !== "MAINTAINER")) {
    return NextResponse.json({ success: false, error: "You are not allowed to upload team photos." }, { status: 403 })
  }

  const mimeType = (request.headers.get("content-type") ?? "").split(";")[0].toLowerCase()
  if (!ALLOWED_TYPES.has(mimeType)) {
    return NextResponse.json({ success: false, error: "Use a JPEG, PNG, or WebP photo." }, { status: 400 })
  }

  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_TEAM_PHOTO_BYTES) {
    return NextResponse.json({ success: false, error: "The prepared photo must be under 750 KB." }, { status: 400 })
  }

  const { id } = await params
  const member = await prisma.member.findUnique({ where: { id }, select: { id: true } })
  if (!member) {
    return NextResponse.json({ success: false, error: "Team member not found." }, { status: 404 })
  }

  // A fresh key per upload: the replaced photo appears at once, with no
  // cache-busting query string to get wrong.
  const key = teamPhotoKey(id, mimeType, randomBytes(8).toString("hex"))
  if (!key) {
    return NextResponse.json({ success: false, error: "Use a JPEG, PNG, or WebP photo." }, { status: 400 })
  }

  let url: string
  try {
    const config = requireS3Config()
    await putObject(key, bytes, mimeType)
    url = publicUrlFor(key, config)
  } catch (err) {
    if (err instanceof MediaNotConfigured) {
      return NextResponse.json(
        { success: false, error: "Photo storage is not configured. Set the S3 variables first." },
        { status: 503 },
      )
    }
    throw err
  }

  await prisma.member.update({
    where: { id },
    data: { imageUrl: url, photoBytes: null, photoMimeType: null },
  })

  await audit(session.user.email, "member.photo", "Member", id)
  revalidatePath("/admin/team")
  revalidatePath("/team")
  return NextResponse.json({ success: true, url })
}
