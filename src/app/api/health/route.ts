import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET() {
  const startedAt = performance.now()

  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json(
      {
        status: "ok",
        environment: process.env.APP_ENV ?? "unknown",
        database: "ok",
        version: process.env.APP_VERSION?.slice(0, 12) ?? "unknown",
        responseMs: Math.round(performance.now() - startedAt),
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    return NextResponse.json(
      {
        status: "unhealthy",
        environment: process.env.APP_ENV ?? "unknown",
        database: "unavailable",
        version: process.env.APP_VERSION?.slice(0, 12) ?? "unknown",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }
}
