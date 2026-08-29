import { NextResponse } from "next/server"
import { deleteMember } from "@/app/(admin)/admin/team/actions"

// A regular JSON endpoint keeps a failed team deletion inside the card instead
// of replacing the entire React Server Components tree with the global error
// boundary. The action still owns authorization, audit and cache invalidation.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const result = await deleteMember(id)
  return NextResponse.json(result, { status: result.success ? 200 : 400 })
}
