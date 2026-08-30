import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { audit } from "@/lib/audit"
import { revalidatePath } from "next/cache"

const MAX_TEAM_PHOTO_BYTES = 750 * 1024
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

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

  const bytes = Buffer.from(await request.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_TEAM_PHOTO_BYTES) {
    return NextResponse.json({ success: false, error: "The prepared photo must be under 750 KB." }, { status: 400 })
  }

  const { id } = await params
  const updated = await prisma.member.updateMany({
    where: { id },
    data: { photoBytes: bytes, photoMimeType: mimeType },
  })
  if (updated.count === 0) {
    return NextResponse.json({ success: false, error: "Team member not found." }, { status: 404 })
  }

  await audit(session.user.email, "member.photo", "Member", id)
  revalidatePath("/admin/team")
  revalidatePath("/team")
  return NextResponse.json({ success: true, url: `/api/team-photo/${id}` })
}
