import { redirect } from "next/navigation"
import { getContent } from "@/lib/settings"
import { prisma } from "@/lib/prisma"
import { currentEventScope } from "@/lib/event"
import { t } from "@/content/strings"
import { RegistrationForm } from "./_components/registration-form"
import { deriveEventState } from "@/lib/event-state"

export default async function RegisterPage() {
  const content = await getContent()

  const state = deriveEventState(content)
  if (!state.acceptsRegistrations) {
    redirect("/register/closed")
  }

  // The Intra MUN registers through its Google Form. Sending people there from
  // HERE means every Register button on the site follows the setting without
  // each one knowing, and there is only one way in: two intake paths would
  // disagree on fields (this form has no roll number) and on duplicates.
  if (state.isIntra && content.registrationFormUrl) {
    redirect(content.registrationFormUrl)
  }

  const committees = await prisma.committee.findMany({
    where: { isActive: true, ...(await currentEventScope()) },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      doubleDelegation: true,
      // Offered as a picker so a preference can be an actual seat rather than a
      // typed guess. Only seats still going, and only once the matrix is public:
      // before that the list is not the society's to show.
      portfolios: content.matrixPublic
        ? {
            where: { status: "AVAILABLE" },
            orderBy: [{ priority: "asc" }, { name: "asc" }],
            select: { id: true, name: true },
          }
        : false,
    },
  })

  return (
    <div className="section-shell max-w-3xl py-12 sm:py-16">
      <h1 className="text-3xl font-semibold">{t("register.pageTitle")}</h1>
      <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{t("marketing.registrationBrief")}</p>
      <div className="mt-8 min-w-0 rounded-lg border border-border bg-card p-5 sm:p-8">
        <RegistrationForm committees={committees} intra={state.isIntra} />
      </div>
    </div>
  )
}
