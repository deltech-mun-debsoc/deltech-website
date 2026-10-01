import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { roleHome } from "@/lib/nav"
import { t } from "@/content/strings"
import { SignOutButton } from "@/components/sign-out-button"

// A chair's whole world. Deliberately not the admin shell: no sidebar, no
// dashboard links, because a chair is usually from outside the secretariat and
// has no business anywhere else. The proxy keeps other roles out; this repeats
// it on the server. Which committee they run is the page's question.
export default async function ChairLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session) redirect("/signin")
  if (role !== "CHAIR") redirect(roleHome(role))

  return (
    <div className="min-h-svh bg-background">
      <header className="flex h-14 items-center justify-between gap-3 border-b border-border/70 px-4 sm:px-6">
        <p className="eyebrow">{t("chair.brand")}</p>
        <SignOutButton />
      </header>
      {children}
    </div>
  )
}
