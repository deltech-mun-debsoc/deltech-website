// A local online-committee to try the committee features by hand: a chair, four
// delegates, one online committee, all allotted. See dev/README.md.
//
//   DEMO_PASSWORD=... DATABASE_URL=postgresql://...@localhost:5433/mun_local \
//     npx tsx scripts/seed-committee-demo.ts
//
// Local databases only. It refuses anything that is not on this machine, and
// anything named like production or staging even through a tunnel. The password
// is yours to choose, from DEMO_PASSWORD; nothing here picks one. Re-running is
// safe: it updates the same rows.
import "dotenv/config"
import { PrismaClient, Role } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { hashPassword } from "../src/lib/password"
import { validatePassword } from "../src/lib/schemas/password"

const url = process.env.DATABASE_URL ?? ""
const password = process.env.DEMO_PASSWORD ?? ""

function refuse(msg: string): never {
  console.error(`seed-committee-demo: ${msg}`)
  process.exit(1)
}

if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) refuse("DATABASE_URL must point at a database on this machine.")
if (!password) refuse("set DEMO_PASSWORD to the password the demo accounts should use.")
const weak = validatePassword(password)
if (weak) refuse(`DEMO_PASSWORD is not acceptable: ${weak}`)

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

const SLUG = "committee-demo"
const CHAIR = { email: "chair@demo.local", name: "Demo Chair" }
// Japan is left unallotted on purpose: an empty seat still counts toward quorum.
const SEATS = [
  { portfolio: "France", email: "france@demo.local" },
  { portfolio: "India", email: "india@demo.local" },
  { portfolio: "Kenya", email: "kenya@demo.local" },
  { portfolio: "Brazil", email: "brazil@demo.local" },
  { portfolio: "Japan", email: null },
]

async function main() {
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`
  if (/^mun_(prod|staging)$/.test(db)) refuse(`refusing to seed ${db}.`)

  // Only one event may be running. If yours is a different one, say so rather
  // than closing it behind your back.
  const running = await prisma.event.findFirst({ where: { state: { notIn: ["CLOSED", "ARCHIVED"] } } })
  if (running && running.slug !== SLUG) {
    refuse(`another event is running here ("${running.name}"). Use a fresh local database, or close that event first.`)
  }

  const passwordHash = await hashPassword(password)
  const verified = new Date()
  const account = (email: string, name: string, role: Role) =>
    prisma.user.upsert({
      where: { email },
      update: { name, role, passwordHash, emailVerified: verified, disabledAt: null },
      create: { email, name, role, passwordHash, emailVerified: verified },
    })

  await account(CHAIR.email, CHAIR.name, Role.MAINTAINER)
  for (const s of SEATS) if (s.email) await account(s.email, `${s.portfolio} Delegate`, Role.REGISTERER)

  const event = await prisma.event.upsert({
    where: { slug: SLUG },
    update: { state: "OPEN" },
    create: { name: "Online Committee Demo", slug: SLUG, state: "OPEN" },
  })
  const committee = await prisma.committee.upsert({
    where: { eventId_slug: { eventId: event.id, slug: "unsc" } },
    update: { format: "ONLINE", isActive: true },
    create: { eventId: event.id, name: "UN Security Council", slug: "unsc", format: "ONLINE", agenda: "Demo agenda" },
  })

  for (const s of SEATS) {
    const portfolio = await prisma.portfolio.upsert({
      where: { committeeId_name: { committeeId: committee.id, name: s.portfolio } },
      update: {},
      create: { committeeId: committee.id, name: s.portfolio },
    })
    if (!s.email) continue
    const delegate = await prisma.delegate.upsert({
      where: { eventId_email: { eventId: event.id, email: s.email } },
      update: { status: "CONFIRMED" },
      create: {
        eventId: event.id,
        fullName: `${s.portfolio} Delegate`,
        email: s.email,
        whatsapp: "9000000000",
        institution: "Demo School",
        status: "CONFIRMED",
      },
    })
    await prisma.allotment.upsert({
      where: { delegateId: delegate.id },
      update: { portfolioId: portfolio.id, committeeId: committee.id },
      create: { delegateId: delegate.id, committeeId: committee.id, portfolioId: portfolio.id, allottedBy: "seed-committee-demo" },
    })
    await prisma.portfolio.update({ where: { id: portfolio.id }, data: { status: "ALLOTTED" } })
  }

  console.log(`Seeded "${committee.name}" (online) in ${db}. Sign in with any of:`)
  console.log(`  ${CHAIR.email}  (chair / dais)`)
  for (const s of SEATS) if (s.email) console.log(`  ${s.email}  (${s.portfolio})`)
  console.log("All use the DEMO_PASSWORD you set.")
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
