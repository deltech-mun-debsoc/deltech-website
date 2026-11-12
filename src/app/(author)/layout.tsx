import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { roleHome } from "@/lib/nav"

const AUTHOR_ROLES = new Set(["AUTHOR", "ADMIN", "MAINTAINER"])

export default async function AuthorLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session) redirect("/signin")
  // Delegates and anyone else without authoring rights go to their own home,
  // not a dead-end, the blog editor is authors + staff only.
  if (!role || !AUTHOR_ROLES.has(role)) redirect(roleHome(role))
  return <div className="app-shell">{children}</div>
}
