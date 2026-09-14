// A free Intra MUN on staging, to walk the whole event flow without payments.
//
// Unlike seed-staging.ts this wipes nothing else: it closes whatever event is
// running, then creates (or recreates) one Intra MUN with committees, a matrix,
// and delegates at every stage a free event has. Staff accounts and passwords
// are untouched.
//
// It runs inside the staging app container, which already holds the database
// connection, so no credential is copied anywhere:
//
//   npx esbuild prisma/seed-intra-staging.ts --bundle --platform=node --format=esm \
//     --target=node22 --external:pg-native --outfile=/tmp/seed-intra.mjs
//   docker compose cp /tmp/seed-intra.mjs app:/tmp/seed-intra.mjs
//   docker compose exec -T app node /tmp/seed-intra.mjs
import { PrismaClient, AppStatus, PortfolioStatus, Source, ContactOutcome, Role, CommitteeType, type Committee, type Portfolio } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const url = process.env.DATABASE_URL ?? ""
if (!/\/mun_staging(\?|$)/.test(url)) {
  console.error("Refusing to run: this only runs against the staging database (mun_staging).")
  process.exit(1)
}

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url })) })

const SLUG = "intra-mun-2026"
const STAFF = "staging+admin@deltechmun.in"
const DAY = 24 * 60 * 60 * 1000
const addr = (local: string) => `staging+intra-${local}@deltechmun.in`

const COMMITTEES: { slug: string; name: string; agenda: string; type: CommitteeType; portfolios: string[] }[] = [
  {
    slug: "unga-disec",
    name: "UNGA DISEC",
    agenda: "Regulating lethal autonomous weapons systems",
    type: CommitteeType.STANDARD,
    portfolios: ["India", "United States", "China", "Russia", "France", "United Kingdom", "Japan", "Germany", "Brazil", "South Africa", "Israel", "Iran", "Pakistan", "Australia", "Egypt", "Indonesia"],
  },
  {
    slug: "unsc",
    name: "UN Security Council",
    agenda: "Maritime security in the Red Sea",
    type: CommitteeType.CRISIS,
    portfolios: ["United States", "China", "Russia", "France", "United Kingdom", "Algeria", "Guyana", "Japan", "Malta", "Mozambique", "Ecuador", "Switzerland", "Slovenia", "Sierra Leone", "Republic of Korea"],
  },
  {
    slug: "unhrc",
    name: "UNHRC",
    agenda: "Digital surveillance and the right to privacy",
    type: CommitteeType.STANDARD,
    portfolios: ["India", "United States", "China", "Germany", "Netherlands", "Kenya", "Qatar", "Chile", "Indonesia", "Morocco", "Finland", "Vietnam"],
  },
  {
    slug: "aippm",
    name: "AIPPM",
    agenda: "One Nation, One Election",
    type: CommitteeType.STANDARD,
    portfolios: ["Prime Minister", "Home Minister", "Law Minister", "Leader of Opposition", "Chief Election Commissioner", "Finance Minister", "Chief Minister, Kerala", "Chief Minister, Punjab", "Chief Minister, Bihar", "Deputy Leader of Opposition", "Parliamentary Affairs Minister", "Rajya Sabha Chairman"],
  },
  {
    slug: "ip",
    name: "International Press",
    agenda: "Covering every committee as it happens",
    type: CommitteeType.PRESS,
    portfolios: ["Reuters", "The Hindu", "Al Jazeera", "BBC", "The Indian Express", "Associated Press", "NDTV", "Deutsche Welle"],
  },
]

const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Ananya", "Vihaan", "Isha", "Arjun", "Saanvi", "Aditya", "Tara", "Reyansh", "Kiara", "Dev", "Nisha", "Ishaan", "Riya", "Aryan", "Zoya", "Karan", "Pooja", "Neel", "Sara", "Yash"]
const LAST = ["Sharma", "Verma", "Gupta", "Mehta", "Kapoor", "Iyer", "Reddy", "Nair", "Bose", "Khan", "Singh", "Das", "Joshi", "Malhotra", "Chopra", "Rao", "Saxena"]
const BRANCHES = ["CO", "IT", "EC", "EE", "ME", "CE", "MC", "EP"]

async function removePreviousRun() {
  const old = await prisma.event.findUnique({ where: { slug: SLUG }, select: { id: true } })
  if (!old) return
  const ids = (await prisma.delegate.findMany({ where: { eventId: old.id }, select: { id: true } })).map((d) => d.id)
  const committeeIds = (await prisma.committee.findMany({ where: { eventId: old.id }, select: { id: true } })).map((c) => c.id)
  await prisma.allotment.deleteMany({ where: { delegateId: { in: ids } } })
  await prisma.payment.deleteMany({ where: { delegateId: { in: ids } } })
  await prisma.emailLog.deleteMany({ where: { delegateId: { in: ids } } })
  await prisma.coDelegate.deleteMany({ where: { delegateId: { in: ids } } })
  await prisma.delegate.deleteMany({ where: { eventId: old.id } })
  await prisma.portfolio.deleteMany({ where: { committeeId: { in: committeeIds } } })
  await prisma.mailCampaign.deleteMany({ where: { eventId: old.id } })
  await prisma.event.delete({ where: { id: old.id } })
  console.log("Removed the previous Intra MUN run.")
}

async function main() {
  await removePreviousRun()

  // Only one event may be active.
  await prisma.event.updateMany({
    where: { state: { notIn: ["CLOSED", "ARCHIVED"] } },
    data: { state: "CLOSED", closedAt: new Date() },
  })
  const event = await prisma.event.create({
    data: {
      name: "DTU Intra MUN 2026",
      slug: SLUG,
      kind: "INTRA_MUN",
      state: "OPEN",
      registrationOpen: true,
      paymentsEnabled: false,
      matrixPublic: true,
      startsAt: new Date("2026-10-10T09:00:00+05:30"),
      endsAt: new Date("2026-10-10T18:00:00+05:30"),
    },
  })
  for (const [key, value] of [
    ["conferenceDates", "10 October 2026"],
    ["venue", "Delhi Technological University, Rohini"],
    ["activeEventLabel", "Intra MUN"],
  ] as const) {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
  }

  console.log("Creating committees and the matrix…")
  const committees: (Committee & { portfolios: Portfolio[] })[] = []
  for (const [i, c] of COMMITTEES.entries()) {
    const committee = await prisma.committee.create({
      data: { eventId: event.id, name: c.name, slug: c.slug, agenda: c.agenda, type: c.type, sortOrder: i, isActive: true },
    })
    await prisma.portfolio.createMany({ data: c.portfolios.map((name, p) => ({ committeeId: committee.id, name, priority: p })) })
    committees.push({
      ...committee,
      portfolios: await prisma.portfolio.findMany({ where: { committeeId: committee.id }, orderBy: { priority: "asc" } }),
    })
  }
  // Two Security Council seats held back for the executive board.
  const unsc = committees.find((c) => c.slug === "unsc")!
  await prisma.portfolio.updateMany({
    where: { id: { in: unsc.portfolios.slice(-2).map((p) => p.id) } },
    data: { status: PortfolioStatus.BLOCKED },
  })

  console.log("Creating delegates…")
  const taken = new Set(unsc.portfolios.slice(-2).map((p) => p.id))
  const seatIn = (committeeIndex: number, offset: number) => {
    const list = committees[committeeIndex].portfolios.filter((p) => !taken.has(p.id))
    return list[offset % list.length]
  }

  const created: { id: string; n: number; status: AppStatus; email: string }[] = []
  for (let n = 1; n <= 50; n++) {
    const i = n - 1
    const status =
      n <= 18 || n >= 48 ? AppStatus.REGISTERED
      : n <= 21 ? AppStatus.WAITLISTED
      : n <= 44 ? AppStatus.CONFIRMED
      : AppStatus.CANCELLED
    const p1 = i % committees.length
    const p2 = (i + 2) % committees.length
    const p3 = (i + 3) % committees.length
    const wanted1 = seatIn(p1, i)
    const wanted2 = seatIn(p2, i + 1)
    const delegate = await prisma.delegate.create({
      data: {
        eventId: event.id,
        fullName: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
        email: addr(`delegate${n}`),
        whatsapp: `919100000${String(n).padStart(3, "0")}`,
        institution: "Delhi Technological University",
        isDtu: true,
        rollNumber: `23/${BRANCHES[i % BRANCHES.length]}/${String(100 + n)}`,
        munExperience: n % 3 === 0 ? "First MUN" : n % 3 === 1 ? "One previous conference" : "Three or more conferences",
        source: Source.SELF,
        status,
        pref1CommitteeId: committees[p1].id,
        pref1Portfolio: wanted1.name,
        // Half chose a seat from the published matrix; the rest typed one.
        pref1PortfolioId: n % 2 === 0 ? wanted1.id : null,
        pref2CommitteeId: committees[p2].id,
        pref2Portfolio: wanted2.name,
        pref2PortfolioId: n % 2 === 0 ? wanted2.id : null,
        pref3CommitteeId: committees[p3].id,
        query:
          n === 3 ? "Is there a dress code for the opening ceremony?"
          : n === 9 ? "Can first-year students apply for the Security Council?"
          : n === 15 ? "Will attendance be marked for classes on the day?"
          : null,
        createdAt: new Date(Date.now() - (60 - n) * 6 * 60 * 60 * 1000),
      },
    })
    created.push({ id: delegate.id, n, status, email: delegate.email })
  }

  // Confirmed delegates hold a seat: in a free event, allotting confirms at once.
  // Most got their first preference, every fourth their second.
  console.log("Allotting seats…")
  for (const d of created.filter((x) => x.status === AppStatus.CONFIRMED)) {
    const i = d.n - 1
    const committeeIndex = d.n % 4 === 0 ? (i + 2) % committees.length : i % committees.length
    const committee = committees[committeeIndex]
    const portfolio = committee.portfolios.find((p) => !taken.has(p.id))
    if (!portfolio) continue
    taken.add(portfolio.id)
    await prisma.allotment.create({
      data: { delegateId: d.id, committeeId: committee.id, portfolioId: portfolio.id, allottedBy: STAFF, emailSentAt: new Date(Date.now() - 2 * DAY) },
    })
    await prisma.portfolio.update({ where: { id: portfolio.id }, data: { status: PortfolioStatus.ALLOTTED } })
    await prisma.emailLog.create({ data: { delegateId: d.id, template: "allotment", toEmail: d.email, status: "SENT" } })
  }

  // A few already through the check-in desk.
  for (const d of created.filter((x) => x.n >= 22 && x.n <= 26)) {
    await prisma.delegate.update({ where: { id: d.id }, data: { checkedInAt: new Date(Date.now() - (d.n - 20) * 60 * 1000), checkedInBy: STAFF } })
  }

  // The follow-up log for a free event: confirming people will actually turn up.
  console.log("Logging follow-up calls…")
  const calls: Record<number, { outcome: ContactOutcome; daysAgo: number; note?: string; followUpInDays?: number }[]> = {
    27: [{ outcome: ContactOutcome.CALLED_NO_ANSWER, daysAgo: 2, followUpInDays: -1 }],
    28: [{ outcome: ContactOutcome.CALLED_REACHED, daysAgo: 1, note: "Confirmed attendance, joined the WhatsApp group" }],
    29: [{ outcome: ContactOutcome.WHATSAPP_SENT, daysAgo: 1, note: "Sent the committee study guide", followUpInDays: 1 }],
    30: [{ outcome: ContactOutcome.CALLED_NO_ANSWER, daysAgo: 4 }, { outcome: ContactOutcome.CALLED_BUSY, daysAgo: 2, note: "In a lab, call after 5pm", followUpInDays: -0.5 }],
    19: [{ outcome: ContactOutcome.CALLED_REACHED, daysAgo: 1, note: "Happy to take any seat that opens up" }],
    46: [{ outcome: ContactOutcome.NOT_INTERESTED, daysAgo: 3, note: "Clashes with a mid-semester exam" }],
  }
  for (const [n, entries] of Object.entries(calls)) {
    const d = created.find((x) => x.n === Number(n))!
    for (const e of entries) {
      await prisma.delegateContact.create({
        data: {
          delegateId: d.id,
          outcome: e.outcome,
          note: e.note ?? null,
          followUpAt: e.followUpInDays === undefined ? null : new Date(Date.now() + e.followUpInDays * DAY),
          createdBy: STAFF,
          createdAt: new Date(Date.now() - e.daysAgo * DAY),
        },
      })
    }
    const last = entries[entries.length - 1]
    await prisma.delegate.update({
      where: { id: d.id },
      data: {
        lastContactedAt: new Date(Date.now() - last.daysAgo * DAY),
        nextFollowUpAt: last.followUpInDays === undefined ? null : new Date(Date.now() + last.followUpInDays * DAY),
      },
    })
  }

  // Accounts: a few delegates signed up first, and one person never applied.
  for (const account of [
    ...created.slice(0, 4).map((d) => ({ email: d.email, name: `Delegate ${d.n}` })),
    { email: addr("signup-only"), name: "Signed Up, Never Applied" },
  ]) {
    await prisma.user.upsert({
      where: { email: account.email },
      update: { role: Role.REGISTERER, disabledAt: null },
      create: { ...account, role: Role.REGISTERER },
    })
  }

  console.log("Drafting a mail…")
  await prisma.mailCampaign.create({
    data: {
      eventId: event.id,
      audience: "DELEGATES",
      filters: { statuses: ["CONFIRMED"], checkedIn: "no" },
      preset: "pre-conference-brief",
      subject: "Intra MUN on Saturday: your seat and what to bring",
      body: "Hi {firstName},\n\nYou are representing {portfolio} in {committee}. Registration opens at 8:30am at the main auditorium; bring your college ID.\n\nSee you there,\nThe Secretariat",
      ctaLabel: "Open my status page",
      ctaUrl: "{statusLink}",
      createdBy: STAFF,
    },
  })

  const counts = await prisma.delegate.groupBy({ by: ["status"], where: { eventId: event.id }, _count: { _all: true } })
  console.log(
    "Intra MUN ready:",
    Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    `${await prisma.allotment.count({ where: { delegate: { eventId: event.id } } })} seats allotted`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
