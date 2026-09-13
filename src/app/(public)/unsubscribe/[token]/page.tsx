import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { verifyUnsubscribeToken } from "@/lib/mailer/unsubscribe"
import { t } from "@/content/strings"

export const metadata: Metadata = { robots: { index: false, follow: false } }

// No sign-in: the person unsubscribing is not a user, and asking them to log in
// to stop getting mail is exactly what gets a sender reported as spam. The signed
// token is what proves the link came from us.
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ done?: string }>
}) {
  const { token } = await params
  const { done } = await searchParams
  const contactId = verifyUnsubscribeToken(token, process.env.AUTH_SECRET ?? "")
  const contact = contactId
    ? await prisma.mailContact.findUnique({ where: { id: contactId }, select: { unsubscribedAt: true } })
    : null

  const unsubscribed = !!contact?.unsubscribedAt || done === "1"

  return (
    <div className="section-shell mx-auto max-w-xl py-24 text-center">
      {!contact ? (
        <>
          <h1 className="font-heading text-3xl">{t("marketing.unsubscribeInvalidTitle")}</h1>
          <p className="mt-4 text-muted-foreground">{t("marketing.unsubscribeInvalidBody")}</p>
        </>
      ) : unsubscribed ? (
        <>
          <h1 className="font-heading text-3xl">{t("marketing.unsubscribeDoneTitle")}</h1>
          <p className="mt-4 text-muted-foreground">{t("marketing.unsubscribeDoneBody")}</p>
        </>
      ) : (
        <>
          <h1 className="font-heading text-3xl">{t("marketing.unsubscribeTitle")}</h1>
          <p className="mt-4 text-muted-foreground">{t("marketing.unsubscribeBody")}</p>
          <form method="post" action={`/api/unsubscribe/${encodeURIComponent(token)}`} className="mt-8">
            <button type="submit" className="rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground">
              {t("marketing.unsubscribeButton")}
            </button>
          </form>
        </>
      )}
    </div>
  )
}
