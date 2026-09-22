import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { t } from "@/content/strings"
import { mySeats, resolveCommitteeViewer } from "@/lib/committee/viewer"
import { CommitteeChat } from "@/components/committee/committee-chat"
import { delegateSendMessage } from "./actions"

export default async function CommitteePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await props.searchParams
  const raw = Array.isArray(params.c) ? params.c[0] : params.c

  const seats = await mySeats()
  const seat = seats.find((s) => s.committeeId === raw) ?? seats[0] ?? null
  // mySeats already proved the seat; resolving again keeps this page on the same
  // single code path the API and actions use, so they cannot disagree.
  const viewer = seat ? await resolveCommitteeViewer(seat.committeeId) : null

  if (!seat || viewer?.kind !== "delegate") {
    return (
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <h1 className="display text-3xl">{t("committeeChat.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("committeeChat.noSeat")}</p>
      </main>
    )
  }

  const committee = await prisma.committee.findUnique({
    where: { id: seat.committeeId },
    select: {
      name: true,
      holdDirectMessages: true,
      portfolios: {
        where: { allotment: { isNot: null }, id: { not: seat.portfolioId } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      },
    },
  })
  if (!committee) return null

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div className="space-y-1">
        <p className="eyebrow">{seat.portfolioName}</p>
        <h1 className="display text-3xl">{committee.name}</h1>
        <p className="text-sm text-muted-foreground">{t("committeeChat.pageDescription")}</p>
      </div>

      {seats.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm">
          {seats.map((s) => (
            <Link
              key={s.committeeId}
              href={`/dashboard/committee?c=${s.committeeId}`}
              className={s.committeeId === seat.committeeId ? "font-semibold underline" : "text-muted-foreground"}
            >
              {s.portfolioName}
            </Link>
          ))}
        </nav>
      )}

      <CommitteeChat
        committeeId={seat.committeeId}
        mode="delegate"
        seats={committee.portfolios}
        holdDirectMessages={committee.holdDirectMessages}
        send={delegateSendMessage}
      />
    </main>
  )
}
