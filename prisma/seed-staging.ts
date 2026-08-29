// Staging-only seed. Wipes the delegate/allotment/payment/blog/quiz tables and
// rebuilds a dataset you can actually exercise the product against.
//
// prisma/seed.ts creates 9 settings, 5 committees, 6 fees and one admin, but
// ZERO portfolios and ZERO delegates. A database seeded with only that has five
// empty committees, which means allotment, payment, check-in and every email
// that depends on them cannot be tested at all. This fills that in.
//
// Email is deliberately live on staging so it can be tested. Delegate,
// applicant, and co-delegate fixtures use a domain we control, and Vercel
// Preview redirects every outbound message to ADMIN_EMAIL. The staff addresses
// below are the explicit test accounts requested by the owner. Never copy
// production application data into staging.
//
//   ALLOW_DESTRUCTIVE_SEED=1 npx tsx prisma/seed-staging.ts
import "dotenv/config"
import { execFileSync } from "node:child_process"
import {
  PrismaClient,
  AppStatus,
  PayStatus,
  PortfolioStatus,
  PostStatus,
  Source,
  QuizMode,
  SlideType,
  Role,
  CycleState,
  RecruitmentRole,
  CandidateStage,
  CandidateResult,
  SessionKind,
  SessionState,
  GroupState,
  Attendance,
  EvaluationState,
  Recommendation,
  Prisma,
} from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

// ---------------------------------------------------------------------------
// Guards. This truncates tables, so it must be impossible to point at prod.
// ---------------------------------------------------------------------------

// The production Supabase project ref. If DATABASE_URL contains this, refuse.
const PROD_DB_REF = "hktvvxtiobeaphzfmpbf"

const url = process.env.DATABASE_URL ?? ""

if (process.env.ALLOW_DESTRUCTIVE_SEED !== "1") {
  console.error(
    "Refusing to run: this seed deletes rows.\n" +
      "Set ALLOW_DESTRUCTIVE_SEED=1 if you really mean it.",
  )
  process.exit(1)
}

if (!url) {
  console.error("Refusing to run: DATABASE_URL is not set.")
  process.exit(1)
}

if (url.includes(PROD_DB_REF)) {
  console.error(
    `Refusing to run: DATABASE_URL points at the production project (${PROD_DB_REF}).\n` +
      "This script is for the staging database only.",
  )
  process.exit(1)
}

const pool = new Pool({ connectionString: url })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

// ---------------------------------------------------------------------------

const DOMAIN = "deltechmun.in"
const addr = (local: string) => `staging+${local}@${DOMAIN}`
const OWNER_EMAIL = "arnavsinghal06@gmail.com"

const TEST_USERS: Array<{ email: string; name: string; role: Role }> = [
  { email: OWNER_EMAIL, name: "Arnav Singhal", role: Role.ADMIN },
  { email: "nikunjsharma4218@gmail.com", name: "Nikunj Sharma", role: Role.ADMIN },
  { email: "samir.gupta987@gmail.com", name: "Samir Gupta", role: Role.ADMIN },
  { email: "enile.puqo249@gmail.com", name: "Test Registerer One", role: Role.REGISTERER },
  { email: "mikebenoit@google.com", name: "Test Registerer Two", role: Role.REGISTERER },
  { email: "arnavsinghal0903@gmail.com", name: "Arnav Maintainer", role: Role.MAINTAINER },
  { email: "nikunjgarcade@gmail.com", name: "Nikunj Maintainer", role: Role.MAINTAINER },
  { email: addr("author"), name: "Test Dispatch Author", role: Role.AUTHOR },
]

const PORTFOLIOS: Record<string, string[]> = {
  "unga-disec": ["France", "India", "Brazil", "Japan", "Kenya", "Norway", "Egypt", "Peru"],
  unhrc: ["Germany", "Canada", "Chile", "Ghana", "Nepal", "Sweden"],
  aippm: ["Home Minister", "Finance Minister", "Leader of Opposition", "Defence Minister"],
  "lok-sabha": ["Speaker", "Member, Bihar", "Member, Kerala", "Member, Assam"],
  ip: ["The Hindu", "Reuters", "Al Jazeera", "BBC"],
}

async function main() {
  // Base seed first: settings, committees, fees, admin. All upserts.
  console.log("Running base seed…")
  execFileSync("npx", ["tsx", "prisma/seed.ts"], { stdio: "inherit" })

  console.log("Clearing staging-only tables…")
  // Order matters: children before parents.
  await prisma.response.deleteMany()
  await prisma.quizSession.deleteMany()
  await prisma.slide.deleteMany()
  await prisma.presentation.deleteMany()
  await prisma.emailLog.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.allotment.deleteMany()
  await prisma.coDelegate.deleteMany()
  await prisma.delegate.deleteMany()
  await prisma.quarantinedRow.deleteMany()
  // RecruitmentAuditEvent is append-only in production (a trigger rejects
  // UPDATE and DELETE). Staging has to clear it, so drop the guard for exactly
  // this statement and put it straight back.
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "RecruitmentAuditEvent" DISABLE TRIGGER "RecruitmentAuditEvent_append_only"',
  )
  try {
    await prisma.recruitmentAuditEvent.deleteMany()
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "RecruitmentAuditEvent" ENABLE TRIGGER "RecruitmentAuditEvent_append_only"',
    )
  }
  // Everything else cascades from the cycle.
  await prisma.recruitmentCycle.deleteMany()
  await prisma.post.deleteMany()
  await prisma.member.deleteMany()
  await prisma.rateLimit.deleteMany()
  await prisma.stringOverride.deleteMany()
  await prisma.importPreset.deleteMany()
  await prisma.portfolio.deleteMany()
  await prisma.auditLog.deleteMany()

  console.log("Creating test staff accounts…")
  for (const user of TEST_USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, disabledAt: null },
      create: user,
    })
  }

  // Use a complete Conference configuration so public registration, payments,
  // committees, matrix, recruitment, and Event Control can all be exercised.
  const testSettings: Array<{ key: string; value: Prisma.InputJsonValue }> = [
    { key: "eventMode", value: "CONFERENCE" },
    { key: "activeEventName", value: "DelTech MUN Test Conference" },
    { key: "activeEventLabel", value: "Test environment" },
    { key: "paymentsEnabled", value: true },
    {
      key: "publicSections",
      value: {
        activeEvent: true,
        registration: true,
        committees: true,
        matrix: true,
        dispatch: true,
        team: true,
        quiz: true,
        recruitment: true,
      },
    },
    { key: "registrationOpen", value: true },
    { key: "registrationClosedMessage", value: "Test registration is currently closed." },
    { key: "conferenceDates", value: "12 to 13 September 2026" },
    { key: "venue", value: "Delhi Technological University, Rohini" },
    {
      key: "landingHero",
      value: {
        title: "DelTech MUN Test Conference",
        subtitle: "A safe environment for testing the complete delegate and organiser journey.",
        ctaLabel: "Test registration",
      },
    },
    { key: "agendasBlurb", value: "Test every committee format with deterministic seeded data." },
    { key: "awards", value: ["Best Delegate", "High Commendation", "Special Mention"] },
    {
      key: "queryContacts",
      value: [{ name: "Test Secretariat", role: "Testing support", phone: "919000000000" }],
    },
    { key: "paymentProvider", value: "razorpay" },
    { key: "matrixPublic", value: true },
    { key: "accommodationNote", value: "Fixture: accommodation requested for selected delegates." },
    { key: "blogIntro", value: "Seeded dispatches covering every editorial state." },
  ]
  for (const setting of testSettings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    })
  }

  await prisma.stringOverride.create({
    data: { key: "marketing.registrationEyebrow", value: "Test registration" },
  })
  await prisma.importPreset.create({
    data: {
      name: "Test CSV import",
      partner: "Fixture partner",
      mapping: {
        fullName: "Name",
        email: "Email",
        whatsapp: "Phone",
        pref1Committee: "First committee",
        pref1Portfolio: "First portfolio",
      },
    },
  })

  const committees = await prisma.committee.findMany({ select: { id: true, slug: true, name: true } })
  const bySlug = new Map(committees.map((c) => [c.slug, c]))

  for (const committee of committees) {
    await prisma.committee.update({
      where: { id: committee.id },
      data: {
        agenda: `Fixture agenda for ${committee.name}`,
        ebMembers: [
          { name: "Test Chair", role: "Chairperson" },
          { name: "Test Vice Chair", role: "Vice Chairperson" },
        ],
        matrixBrief: `Seeded availability for ${committee.name}.`,
        portfolioTagLabel: committee.slug === "unhrc" ? "Membership" : "Category",
      },
    })
  }

  console.log("Creating portfolios…")
  for (const [slug, names] of Object.entries(PORTFOLIOS)) {
    const committee = bySlug.get(slug)
    if (!committee) continue
    await prisma.portfolio.createMany({
      data: names.map((name, i) => ({ committeeId: committee.id, name, priority: i })),
    })
  }

  const disec = bySlug.get("unga-disec")!
  const unhrc = bySlug.get("unhrc")!
  const ip = bySlug.get("ip")!

  const fees = await prisma.fee.findMany()
  const feeFor = (committeeType: string, isDtu: boolean) =>
    fees.find((f) => f.committeeType === committeeType && f.isDtu === isDtu)?.amountInr ?? 1600

  // A delegate for every AppStatus, so every filter, badge and flow has
  // something to act on.
  console.log("Creating delegates…")

  const mkDelegate = (
    n: number,
    status: AppStatus,
    overrides: Partial<Prisma.DelegateCreateInput> = {},
  ): Prisma.DelegateCreateInput => ({
    fullName: `Test Delegate ${n}`,
    email: addr(`delegate${n}`),
    whatsapp: `919000000${String(n).padStart(3, "0")}`,
    institution: n % 3 === 0 ? "Delhi Technological University" : `Institution ${n}`,
    isDtu: n % 3 === 0,
    munExperience: n % 2 === 0 ? "Two previous conferences" : null,
    source: [
      Source.SELF,
      Source.CROSS_DEL,
      Source.SPONSORED,
      Source.INTERNAL,
      Source.MANUAL,
    ][(n - 1) % 5],
    sourceNote: n % 5 === 1 ? null : `Fixture source for delegate ${n}`,
    status,
    pref1CommitteeId: disec.id,
    pref1Portfolio: "France",
    pref2CommitteeId: ip.id,
    pref2Portfolio: "Reuters",
    ...overrides,
  })

  // 6 unallotted, so the allotment board has a queue to work through.
  for (let n = 1; n <= 6; n++) {
    await prisma.delegate.create({ data: mkDelegate(n, AppStatus.REGISTERED) })
  }
  await prisma.delegate.create({
    data: mkDelegate(7, AppStatus.WAITLISTED),
  })
  await prisma.delegate.create({
    data: mkDelegate(8, AppStatus.CANCELLED),
  })

  // ALLOTTED, payment PENDING: the "allotted but no link yet" state.
  const allotted = await prisma.delegate.create({ data: mkDelegate(9, AppStatus.ALLOTTED) })
  const p9 = await prisma.portfolio.findFirstOrThrow({
    where: { committeeId: disec.id, status: PortfolioStatus.AVAILABLE },
  })
  await prisma.allotment.create({
    data: { delegateId: allotted.id, committeeId: disec.id, portfolioId: p9.id, allottedBy: "seed" },
  })
  await prisma.portfolio.update({ where: { id: p9.id }, data: { status: PortfolioStatus.ALLOTTED } })
  await prisma.payment.create({
    data: {
      delegateId: allotted.id,
      provider: "upi_qr",
      amountInr: feeFor("STANDARD", false),
      status: PayStatus.PENDING,
    },
  })

  // PAYMENT_SENT with a link: this is what /pay/[token] renders.
  const paying = await prisma.delegate.create({ data: mkDelegate(10, AppStatus.PAYMENT_SENT) })
  const p10 = await prisma.portfolio.findFirstOrThrow({
    where: { committeeId: disec.id, status: PortfolioStatus.AVAILABLE },
  })
  await prisma.allotment.create({
    data: { delegateId: paying.id, committeeId: disec.id, portfolioId: p10.id, allottedBy: "seed" },
  })
  await prisma.portfolio.update({ where: { id: p10.id }, data: { status: PortfolioStatus.ALLOTTED } })
  await prisma.payment.create({
    data: {
      delegateId: paying.id,
      provider: "upi_qr",
      amountInr: feeFor("STANDARD", false),
      status: PayStatus.SENT,
      paymentLink: `/pay/${paying.publicToken}`,
    },
  })

  // CONFIRMED and paid: the check-in desk needs one of these to scan.
  const confirmed = await prisma.delegate.create({
    data: mkDelegate(11, AppStatus.CONFIRMED, { isDtu: true }),
  })
  const p11 = await prisma.portfolio.findFirstOrThrow({
    where: { committeeId: ip.id, status: PortfolioStatus.AVAILABLE },
  })
  await prisma.allotment.create({
    data: { delegateId: confirmed.id, committeeId: ip.id, portfolioId: p11.id, allottedBy: "seed" },
  })
  await prisma.portfolio.update({ where: { id: p11.id }, data: { status: PortfolioStatus.ALLOTTED } })
  await prisma.payment.create({
    data: {
      delegateId: confirmed.id,
      provider: "upi_qr",
      amountInr: feeFor("PRESS", true),
      status: PayStatus.PAID,
      confirmedAt: new Date(),
    },
  })

  async function createFinalPaymentFixture(
    n: number,
    status: PayStatus,
    committeeId: string,
    committeeType: string,
    provider: string,
  ) {
    const delegate = await prisma.delegate.create({
      data: mkDelegate(
        n,
        status === PayStatus.FAILED ? AppStatus.PAYMENT_SENT : AppStatus.CONFIRMED,
      ),
    })
    const portfolio = await prisma.portfolio.findFirstOrThrow({
      where: { committeeId, status: PortfolioStatus.AVAILABLE },
    })
    await prisma.allotment.create({
      data: {
        delegateId: delegate.id,
        committeeId,
        portfolioId: portfolio.id,
        allottedBy: OWNER_EMAIL,
        emailSentAt: new Date(),
      },
    })
    await prisma.portfolio.update({
      where: { id: portfolio.id },
      data: { status: PortfolioStatus.ALLOTTED },
    })
    await prisma.payment.create({
      data: {
        delegateId: delegate.id,
        provider,
        amountInr: feeFor(committeeType, delegate.isDtu),
        status,
        method: status === PayStatus.OFFLINE ? "cash" : null,
        paymentLink: status === PayStatus.FAILED ? `/pay/${delegate.publicToken}` : null,
        confirmedAt: status === PayStatus.FAILED ? null : new Date(),
      },
    })
    return delegate
  }

  const aippm = bySlug.get("aippm")!
  const lokSabha = bySlug.get("lok-sabha")!
  const failed = await createFinalPaymentFixture(13, PayStatus.FAILED, disec.id, "STANDARD", "razorpay")
  const comped = await createFinalPaymentFixture(14, PayStatus.COMPED, aippm.id, "STANDARD", "manual")
  const offline = await createFinalPaymentFixture(15, PayStatus.OFFLINE, lokSabha.id, "STANDARD", "manual")

  await prisma.delegate.update({
    where: { id: confirmed.id },
    data: { checkedInAt: new Date(), checkedInBy: OWNER_EMAIL },
  })

  // UNHRC double delegation: its own allotment branch and its own emails.
  const primary = await prisma.delegate.create({
    data: {
      ...mkDelegate(12, AppStatus.REGISTERED, {
        pref1CommitteeId: unhrc.id,
        pref1Portfolio: "Germany",
        pref2CommitteeId: null,
        pref2Portfolio: null,
      }),
      coDelegate: {
        create: {
          fullName: "Test Co-delegate",
          email: addr("codelegate"),
          phone: "919000000912",
          institution: "Institution 12",
        },
      },
    },
  })
  console.log(`  double-delegation primary: ${primary.email}`)

  const blockedPortfolio = await prisma.portfolio.findFirstOrThrow({
    where: { committeeId: ip.id, status: PortfolioStatus.AVAILABLE },
  })
  await prisma.portfolio.update({
    where: { id: blockedPortfolio.id },
    data: { status: PortfolioStatus.BLOCKED },
  })
  const heldPortfolio = await prisma.portfolio.findFirstOrThrow({
    where: { committeeId: unhrc.id, status: PortfolioStatus.AVAILABLE },
  })
  await prisma.portfolio.update({
    where: { id: heldPortfolio.id },
    data: {
      status: PortfolioStatus.ON_HOLD,
      holdToken: "staging-fixture-hold",
      holdExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  })

  console.log("Creating email history…")
  await prisma.emailLog.createMany({
    data: [
      {
        delegateId: allotted.id,
        template: "allotment",
        toEmail: allotted.email,
        status: "SENT",
      },
      {
        delegateId: paying.id,
        template: "payment-link",
        toEmail: paying.email,
        status: "SENT",
      },
      {
        delegateId: failed.id,
        template: "payment-reminder",
        toEmail: failed.email,
        status: "FAILED",
        error: "Fixture delivery failure for retry testing.",
      },
      {
        delegateId: comped.id,
        template: "confirmation",
        toEmail: comped.email,
        status: "SENT",
      },
      {
        delegateId: offline.id,
        template: "confirmation",
        toEmail: offline.email,
        status: "SENT",
      },
    ],
  })

  console.log("Creating quarantined rows…")
  await prisma.quarantinedRow.createMany({
    data: [
      {
        source: Source.CROSS_DEL,
        presetName: "Partner MUN",
        raw: { fullName: "Broken Row", email: "not-an-email", committee: "Unknown Committee" },
        errors: ["email: Invalid email", "committee: did not resolve"],
      },
      {
        source: Source.CROSS_DEL,
        presetName: "Partner MUN",
        raw: { fullName: "", email: addr("quarantine2"), committee: "UNGA-DISEC" },
        errors: ["fullName: Required"],
      },
    ],
  })

  console.log("Creating recruitment cycle…")
  // Recruitment is cycle-scoped now. Seed one live cycle covering every stage
  // and result, so /admin/recruitment and /recruitment both have something real
  // to show: an unassigned intake, a running GD with two evaluators, a
  // deliberately bypassed candidate, and decided outcomes.
  const councilAdmin = await prisma.user.findUniqueOrThrow({ where: { email: OWNER_EMAIL } })
  const councilSenior = await prisma.user.findUniqueOrThrow({
    where: { email: "arnavsinghal0903@gmail.com" },
  })
  const councilJunior = await prisma.user.findUniqueOrThrow({
    where: { email: "nikunjgarcade@gmail.com" },
  })

  const cycle = await prisma.recruitmentCycle.create({
    data: {
      name: "Test Recruitment 2026",
      slug: "test-recruitment-2026",
      state: CycleState.IN_PROGRESS,
      openedAt: new Date("2026-08-01T09:00:00+05:30"),
      createdById: councilAdmin.id,
      config: {
        stages: {
          gdRequiredByDefault: true,
          piRequiredByDefault: true,
          minGdEvaluations: 1,
          minPiEvaluations: 1,
          gdPlannedSeconds: 900,
          piPlannedSeconds: 600,
          allowGdBypass: true,
        },
        gdCriteria: [
          { key: "content", label: "Content & research", max: 10, weight: 1 },
          { key: "communication", label: "Communication", max: 10, weight: 1 },
          { key: "collaboration", label: "Collaboration", max: 10, weight: 1 },
        ],
        piCriteria: [
          { key: "motivation", label: "Motivation & fit", max: 10, weight: 1 },
          { key: "reasoning", label: "Reasoning", max: 10, weight: 1 },
          { key: "ownership", label: "Ownership", max: 10, weight: 1 },
        ],
        societyRoles: ["MEMBER"],
      },
    },
  })

  // The council. Recruitment authority comes from these rows, not from the
  // dashboard role, so a Senior Council member here is still only a MAINTAINER
  // in the admin console.
  const [memberAdmin, memberSenior, memberJunior] = await Promise.all([
    prisma.recruitmentMember.create({
      data: { cycleId: cycle.id, userId: councilAdmin.id, role: RecruitmentRole.ADMIN, assignedById: councilAdmin.id },
    }),
    prisma.recruitmentMember.create({
      data: { cycleId: cycle.id, userId: councilSenior.id, role: RecruitmentRole.MAINTAINER, assignedById: councilAdmin.id },
    }),
    prisma.recruitmentMember.create({
      data: { cycleId: cycle.id, userId: councilJunior.id, role: RecruitmentRole.JC, assignedById: councilAdmin.id },
    }),
  ])

  const candidateFixtures: Array<Prisma.RecruitmentCandidateCreateManyInput> = [
    {
      cycleId: cycle.id,
      fullName: "Test Candidate Intake",
      email: addr("candidate-intake"),
      phone: "919100000001",
      year: "First",
      branch: "Software Engineering",
      formAnswers: { why: "Fixture not yet assigned to a group." },
      stage: CandidateStage.INTAKE,
    },
    {
      cycleId: cycle.id,
      fullName: "Test Candidate Awaiting GD",
      email: addr("candidate-gd-pending"),
      phone: "919100000002",
      year: "Second",
      branch: "Mechanical Engineering",
      formAnswers: { why: "Fixture seated in a GD group." },
      stage: CandidateStage.GD_PENDING,
    },
    {
      cycleId: cycle.id,
      fullName: "Test Candidate In GD",
      email: addr("candidate-gd-active"),
      phone: "919100000003",
      year: "First",
      branch: "Electrical Engineering",
      formAnswers: { why: "Fixture in the running GD." },
      stage: CandidateStage.GD_ACTIVE,
    },
    {
      cycleId: cycle.id,
      // The case the dossier has to render as a decision rather than as
      // missing data.
      fullName: "Test Candidate GD Bypassed",
      email: addr("candidate-bypassed"),
      phone: "919100000004",
      year: "Third",
      branch: "Civil Engineering",
      formAnswers: { why: "Fixture sent straight to interview." },
      stage: CandidateStage.GD_BYPASSED,
      gdRequired: false,
    },
    {
      cycleId: cycle.id,
      fullName: "Test Candidate Awaiting Interview",
      email: addr("candidate-pi-pending"),
      phone: "919100000005",
      year: "Second",
      branch: "Engineering Physics",
      formAnswers: { why: "Fixture through GD, waiting on PI." },
      stage: CandidateStage.PI_PENDING,
    },
    {
      cycleId: cycle.id,
      fullName: "Test Candidate On Hold",
      email: addr("candidate-on-hold"),
      phone: "919100000006",
      year: "First",
      branch: "Mathematics and Computing",
      formAnswers: { why: "Fixture parked for review." },
      stage: CandidateStage.DECISION,
      result: CandidateResult.ON_HOLD,
    },
    {
      cycleId: cycle.id,
      fullName: "Test Candidate Selected",
      email: addr("candidate-selected"),
      phone: "919100000007",
      year: "First",
      branch: "Biotechnology",
      formAnswers: { why: "Fixture selected, not yet in the society." },
      stage: CandidateStage.CLOSED,
      result: CandidateResult.SELECTED,
      decidedById: councilAdmin.id,
      decidedAt: new Date("2026-08-08T18:00:00+05:30"),
    },
    {
      cycleId: cycle.id,
      fullName: "Test Candidate Rejected",
      email: addr("candidate-rejected"),
      phone: "919100000008",
      year: "Second",
      branch: "Environmental Engineering",
      formAnswers: { why: "Fixture rejected after assessment." },
      stage: CandidateStage.CLOSED,
      result: CandidateResult.REJECTED,
      decidedById: councilAdmin.id,
      decidedAt: new Date("2026-08-08T18:05:00+05:30"),
    },
    {
      cycleId: cycle.id,
      fullName: "Test Candidate Withdrawn",
      email: addr("candidate-withdrawn"),
      phone: "919100000009",
      year: "Third",
      branch: "Production Engineering",
      formAnswers: { why: "Fixture who withdrew." },
      stage: CandidateStage.CLOSED,
      result: CandidateResult.WITHDRAWN,
    },
  ]
  await prisma.recruitmentCandidate.createMany({ data: candidateFixtures })

  const candidates = await prisma.recruitmentCandidate.findMany({
    where: { cycleId: cycle.id },
    select: { id: true, email: true },
  })
  const candidateByEmail = new Map(candidates.map((c) => [c.email, c.id]))
  const candidateId = (slug: string) => candidateByEmail.get(addr(slug))!

  // A GD group that is mid-session, so the timer, roster and evaluation panel
  // all have something to render.
  const gdGroup = await prisma.recruitmentGroup.create({
    data: {
      cycleId: cycle.id,
      kind: SessionKind.GD,
      title: "Morning batch A",
      state: GroupState.RUNNING,
      scheduledAt: new Date("2026-08-05T10:00:00+05:30"),
      createdById: councilSenior.id,
      members: {
        create: [
          {
            candidateId: candidateId("candidate-gd-active"),
            kind: SessionKind.GD,
            attendance: Attendance.PRESENT,
            joinedAt: new Date("2026-08-05T10:01:00+05:30"),
            addedById: councilSenior.id,
          },
          {
            candidateId: candidateId("candidate-gd-pending"),
            kind: SessionKind.GD,
            attendance: Attendance.ABSENT,
            joinedAt: new Date("2026-08-05T10:06:00+05:30"),
            addedById: councilSenior.id,
          },
        ],
      },
      staff: {
        create: [
          { memberId: memberSenior.id, role: RecruitmentRole.MAINTAINER, canEvaluate: true, assignedById: councilAdmin.id },
          // A JC only scores where a Senior Council member allowed it.
          { memberId: memberJunior.id, role: RecruitmentRole.JC, canEvaluate: true, assignedById: councilAdmin.id },
        ],
      },
    },
  })

  const gdStartedAt = new Date(Date.now() - 4 * 60 * 1000)
  const gdSession = await prisma.recruitmentSession.create({
    data: {
      cycleId: cycle.id,
      groupId: gdGroup.id,
      kind: SessionKind.GD,
      attempt: 1,
      state: SessionState.ACTIVE,
      // Relative to now, so the seeded session reads as genuinely live rather
      // than as a stale one from a fixed date in the past.
      startedAt: gdStartedAt,
      lastActivityAt: new Date(),
      controllerId: councilSenior.id,
      controlExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
      startedById: councilSenior.id,
      plannedSeconds: 900,
    },
  })

  await prisma.recruitmentCandidateLock.create({
    data: {
      candidateId: candidateId("candidate-gd-active"),
      sessionId: gdSession.id,
      cycleId: cycle.id,
    },
  })

  // Two evaluators on one candidate, so the aggregate and the per-evaluator
  // attribution are both exercised.
  await prisma.recruitmentEvaluation.createMany({
    data: [
      {
        cycleId: cycle.id,
        candidateId: candidateId("candidate-gd-active"),
        kind: SessionKind.GD,
        groupId: gdGroup.id,
        sessionId: gdSession.id,
        evaluatorId: councilSenior.id,
        evaluatorRole: RecruitmentRole.MAINTAINER,
        scores: { content: 8, communication: 7, collaboration: 9 },
        overall: 8,
        remarks: "Structured, brought the group back on topic twice.",
        recommendation: Recommendation.ADVANCE,
        state: EvaluationState.SUBMITTED,
        submittedAt: new Date(),
      },
      {
        cycleId: cycle.id,
        candidateId: candidateId("candidate-gd-active"),
        kind: SessionKind.GD,
        groupId: gdGroup.id,
        sessionId: gdSession.id,
        evaluatorId: councilJunior.id,
        evaluatorRole: RecruitmentRole.JC,
        scores: { content: 7, communication: 8, collaboration: 8 },
        overall: 7.67,
        remarks: "Clear, a little quiet in the opening.",
        recommendation: Recommendation.ADVANCE,
        state: EvaluationState.SUBMITTED,
        submittedAt: new Date(),
      },
      // A draft, so the console shows unsubmitted panel work too.
      {
        cycleId: cycle.id,
        candidateId: candidateId("candidate-gd-pending"),
        kind: SessionKind.GD,
        groupId: gdGroup.id,
        sessionId: gdSession.id,
        evaluatorId: councilSenior.id,
        evaluatorRole: RecruitmentRole.MAINTAINER,
        scores: { content: 6 },
        remarks: "Part-way through.",
        state: EvaluationState.DRAFT,
      },
    ],
  })

  // The permanent bypass record the PI dossier reads.
  await prisma.recruitmentHandoff.create({
    data: {
      cycleId: cycle.id,
      candidateId: candidateId("candidate-bypassed"),
      fromStage: CandidateStage.GD_PENDING,
      toStage: CandidateStage.GD_BYPASSED,
      bypass: true,
      reason: "Chaired two conferences already; the panel agreed GD would tell us nothing new.",
      actorId: councilSenior.id,
      actorRole: RecruitmentRole.MAINTAINER,
      previousState: { stage: "GD_PENDING", gdRequired: true },
      newState: { stage: "GD_BYPASSED", gdRequired: false },
    },
  })

  // One successful and one refused event, so the audit viewer's outcome filter
  // has both to show.
  await prisma.recruitmentAuditEvent.createMany({
    data: [
      {
        cycleId: cycle.id,
        eventType: "cycle.transition",
        actorId: councilAdmin.id,
        actorEmail: councilAdmin.email,
        actorRole: RecruitmentRole.ADMIN,
        previousState: { state: "OPEN" },
        newState: { state: "IN_PROGRESS" },
        outcome: "SUCCESS",
      },
      {
        cycleId: cycle.id,
        eventType: "action.denied",
        candidateId: candidateId("candidate-bypassed"),
        actorId: councilJunior.id,
        actorEmail: councilJunior.email,
        actorRole: RecruitmentRole.JC,
        reason: "Role JC may not candidate.bypassGd.",
        meta: { action: "candidate.bypassGd", role: "JC" },
        outcome: "REJECTED",
      },
    ],
  })

  console.log("Creating team members…")
  await prisma.member.createMany({
    data: [
      {
        name: "Test Secretary-General",
        designation: "Secretary-General",
        order: 1,
        socials: { linkedin: "https://www.linkedin.com" },
      },
      {
        name: "Test Director-General",
        designation: "Director-General",
        order: 2,
        socials: { instagram: "https://www.instagram.com" },
      },
      {
        name: "Archived Test Member",
        designation: "Former Secretariat",
        order: 3,
        isActive: false,
      },
    ],
  })

  console.log("Creating audit and rate-limit fixtures…")
  await prisma.auditLog.createMany({
    data: [
      {
        actorEmail: OWNER_EMAIL,
        action: "settings.update",
        entity: "Setting",
        entityId: "registration",
        meta: {
          summary: "Fixture reversible registration change",
          rollback: {
            kind: "settings",
            before: { registrationClosedMessage: "Fixture closed" },
            after: { registrationClosedMessage: "Test registration is currently closed." },
          },
        },
      },
      {
        actorEmail: "arnavsinghal0903@gmail.com",
        action: "delegate.update",
        entity: "Delegate",
        entityId: allotted.id,
        meta: {
          summary: "Fixture delegate edit",
          before: { status: "REGISTERED" },
          after: { status: "ALLOTTED" },
        },
      },
      {
        actorEmail: OWNER_EMAIL,
        action: "payment.comp",
        entity: "Delegate",
        entityId: comped.id,
        meta: { summary: "Fixture comped payment" },
      },
    ],
  })
  await prisma.rateLimit.create({
    data: {
      key: "staging-fixture:expired-window",
      count: 2,
      windowStart: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
  })

  console.log("Creating blog posts…")
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: OWNER_EMAIL } })
  const dispatchAuthor = await prisma.user.findUniqueOrThrow({ where: { email: addr("author") } })
  const body = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  })
  const posts: Array<[PostStatus, string, string | null]> = [
    [PostStatus.PUBLISHED, "Notes from the floor", null],
    [PostStatus.PENDING, "A draft awaiting review", null],
    [PostStatus.CHANGES_REQUESTED, "Needs a tighter intro", "Tighten the opening two paragraphs."],
    [PostStatus.REJECTED, "Not running this one", "Off-topic for the dispatch."],
    [PostStatus.DRAFT, "Untitled draft", null],
  ]
  for (const [status, title, reviewNote] of posts) {
    await prisma.post.create({
      data: {
        authorId: dispatchAuthor.id,
        title,
        slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, ""),
        contentJson: body(`Staging fixture for the ${status} state.`),
        status,
        reviewNote,
        readMin: 3,
        tags: ["staging"],
        submittedAt: status === PostStatus.DRAFT ? null : new Date(),
        publishedAt: status === PostStatus.PUBLISHED ? new Date() : null,
      },
    })
  }

  console.log("Creating a quiz…")
  const presentation = await prisma.presentation.create({
    data: { ownerId: admin.id, title: "Staging quiz", mode: QuizMode.QUIZ },
  })
  await prisma.slide.createMany({
    data: [
      {
        presentationId: presentation.id,
        order: 0,
        type: SlideType.MCQ,
        prompt: "Which body can authorise the use of force?",
        config: {
          options: ["General Assembly", "Security Council", "ECOSOC", "Secretariat"],
          correct: [1],
          timerSeconds: 20,
        },
      },
      {
        presentationId: presentation.id,
        order: 1,
        type: SlideType.WORDCLOUD,
        prompt: "One word for this committee so far",
        config: { maxWords: 3 },
      },
    ],
  })

  const quizSlides = await prisma.slide.findMany({
    where: { presentationId: presentation.id },
    orderBy: { order: "asc" },
  })
  const quizSession = await prisma.quizSession.create({
    data: {
      presentationId: presentation.id,
      roomCode: "TEST01",
      status: "active",
      currentSlideId: quizSlides[0].id,
      currentSlideStartedAt: new Date(),
      startedAt: new Date(),
    },
  })
  await prisma.response.createMany({
    data: [
      {
        sessionId: quizSession.id,
        slideId: quizSlides[0].id,
        nickname: "Fixture Alpha",
        answer: 1,
        points: 980,
      },
      {
        sessionId: quizSession.id,
        slideId: quizSlides[0].id,
        nickname: "Fixture Beta",
        answer: 0,
        points: 0,
      },
      {
        sessionId: quizSession.id,
        slideId: quizSlides[1].id,
        nickname: "Fixture Gamma",
        answer: "diplomacy",
        points: 0,
      },
    ],
  })

  const counts = {
    users: await prisma.user.count(),
    settings: await prisma.setting.count(),
    committees: await prisma.committee.count(),
    delegates: await prisma.delegate.count(),
    portfolios: await prisma.portfolio.count(),
    allotments: await prisma.allotment.count(),
    payments: await prisma.payment.count(),
    emailLogs: await prisma.emailLog.count(),
    recruitmentCycles: await prisma.recruitmentCycle.count(),
    recruitmentCandidates: await prisma.recruitmentCandidate.count(),
    recruitmentGroups: await prisma.recruitmentGroup.count(),
    recruitmentEvaluations: await prisma.recruitmentEvaluation.count(),
    members: await prisma.member.count(),
    auditLogs: await prisma.auditLog.count(),
    posts: await prisma.post.count(),
    presentations: await prisma.presentation.count(),
    quizSessions: await prisma.quizSession.count(),
    responses: await prisma.response.count(),
    importPresets: await prisma.importPreset.count(),
    quarantined: await prisma.quarantinedRow.count(),
  }
  console.log("\nStaging seed complete:", counts)
  console.log(`Admin sign-in: ${admin.email}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
