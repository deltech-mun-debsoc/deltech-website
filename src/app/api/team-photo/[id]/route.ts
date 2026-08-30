import { prisma } from "@/lib/prisma"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const member = await prisma.member.findUnique({
    where: { id },
    select: { photoBytes: true, photoMimeType: true, updatedAt: true },
  })
  if (!member?.photoBytes || !member.photoMimeType) {
    return new Response("Photo not found.", { status: 404 })
  }

  return new Response(member.photoBytes, {
    headers: {
      "Content-Type": member.photoMimeType,
      "Content-Length": String(member.photoBytes.byteLength),
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Last-Modified": member.updatedAt.toUTCString(),
    },
  })
}
