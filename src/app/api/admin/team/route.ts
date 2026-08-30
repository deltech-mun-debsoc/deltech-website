import { NextResponse } from "next/server"
import { createMember, type MemberData } from "@/app/(admin)/admin/team/actions"

export async function POST(request: Request) {
  try {
    const data = (await request.json()) as MemberData
    const result = await createMember(data)
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (error) {
    console.error("[api/admin/team/create]", error)
    return NextResponse.json({ success: false, error: "Could not add the member." }, { status: 500 })
  }
}
