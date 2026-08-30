import { NextResponse } from "next/server"
import { deleteMember, updateMember, type MemberData } from "@/app/(admin)/admin/team/actions"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const data = (await request.json()) as MemberData
    const result = await updateMember(id, data)
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (error) {
    console.error("[api/admin/team/update]", error)
    return NextResponse.json({ success: false, error: "Could not update the member." }, { status: 500 })
  }
}

// A regular JSON endpoint keeps a failed team deletion inside the card instead
// of replacing the entire React Server Components tree with the global error
// boundary. The action still owns authorization, audit and cache invalidation.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const result = await deleteMember(id)
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (error) {
    console.error("[api/admin/team/delete]", error)
    return NextResponse.json({ success: false, error: "Could not remove the member." }, { status: 500 })
  }
}
