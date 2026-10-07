import Link from "next/link"
import { t } from "@/content/strings"
import { BrandMark } from "@/components/brand-logo"

// The sign-in family: sign-in, sign-up, check-your-email and the account page.
// A slim bar with the mark, then the form centred on the page. On a phone the
// form starts directly under the bar.
export function BrandBar() {
  return (
    <header className="section-shell flex h-16 shrink-0 items-center">
      <Link href="/" className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <BrandMark className="h-6" />
        <span className="font-semibold">{t("brand.name")}</span>
      </Link>
    </header>
  )
}

export function AuthStage({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col bg-background text-foreground">
      <BrandBar />
      <div className="flex flex-1 justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm sm:-mt-16">{children}</div>
      </div>
    </main>
  )
}
