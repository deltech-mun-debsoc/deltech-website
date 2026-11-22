import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"

export default async function AuthorLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/blog/write")
  return <>{children}</>
}
