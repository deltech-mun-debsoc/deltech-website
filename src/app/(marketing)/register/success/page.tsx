import Link from "next/link"
import { CheckCircle2 } from "lucide-react"
import { t } from "@/content/strings"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { prisma } from "@/lib/prisma"
import { getContent } from "@/lib/settings"
import { deriveEventState } from "@/lib/event-state"

export default async function RegisterSuccessPage(props: {
  searchParams: Promise<{ t?: string }>
}) {
  const { t: token } = await props.searchParams
  // Only a token that belongs to a real registration earns "received". A bare
  // visit, or a mistyped link, has submitted nothing and must not be told so.
  const delegate = token
    ? await prisma.delegate.findUnique({ where: { publicToken: token }, select: { publicToken: true } })
    : null

  if (!delegate) {
    return (
      <div className="section-shell max-w-2xl py-16 sm:py-24">
        <h1 className="text-3xl font-semibold">{t("register.success.noTokenTitle")}</h1>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{t("register.success.noTokenBody")}</p>
        <Link href="/register" className={cn(buttonVariants({ size: "lg" }), "mt-8")}>
          {t("register.success.registerCta")}
        </Link>
      </div>
    )
  }

  const content = await getContent()
  // Free because the event charges nothing, not because of what it is called.
  const isFree = !deriveEventState(content).paymentsRequired
  return (
    <div className="section-shell max-w-2xl py-16 sm:py-24">
      <h1 className="flex items-center gap-3 text-3xl font-semibold">
        <CheckCircle2 className="size-8 shrink-0 text-primary" aria-hidden />
        {t("register.success.title")}
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
        {isFree ? t("marketing.freeRegistrationReceived") : t("register.success.message")}
      </p>
      <div className="mt-8 rounded-lg border border-border p-5">
        <p className="font-semibold">{t("register.success.trackTitle")}</p>
        <Link
          href={`/status/${delegate.publicToken}`}
          className="mt-2 block break-all font-mono text-sm text-primary underline underline-offset-4"
        >
          /status/{delegate.publicToken}
        </Link>
        <p className="mt-2 text-sm text-muted-foreground">{t("register.success.trackNote")}</p>
      </div>
    </div>
  )
}
