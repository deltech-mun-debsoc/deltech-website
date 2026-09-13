import "dotenv/config";
import { PrismaClient, CommitteeType, Role, Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Settings
  const settings: Array<{ key: string; value: Prisma.InputJsonValue }> = [
    { key: "registrationOpen", value: false },
    { key: "conferenceDates",  value: "" },
    { key: "venue",            value: "" },
    { key: "paymentProvider",  value: "upi_qr" },
    { key: "accommodationNote", value: "" },
    { key: "agendasBlurb",    value: "" },
    { key: "awards",          value: [] },
    { key: "queryContacts",   value: [] },
    { key: "landingHero",     value: { title: "DelTech MUN", subtitle: "", ctaLabel: "Register Now" } },
  ];

  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: {},
      create: { key: s.key, value: s.value },
    });
  }

  // Committees
  const committees: Array<{
    name: string;
    slug: string;
    type: CommitteeType;
    doubleDelegation: boolean;
    sortOrder: number;
  }> = [
    { name: "UNGA-DISEC", slug: "unga-disec", type: CommitteeType.STANDARD, doubleDelegation: false, sortOrder: 1 },
    { name: "UNHRC", slug: "unhrc", type: CommitteeType.STANDARD, doubleDelegation: true, sortOrder: 2 },
    { name: "AIPPM", slug: "aippm", type: CommitteeType.CRISIS, doubleDelegation: false, sortOrder: 3 },
    { name: "Lok Sabha", slug: "lok-sabha", type: CommitteeType.CRISIS, doubleDelegation: false, sortOrder: 4 },
    { name: "IP", slug: "ip", type: CommitteeType.PRESS, doubleDelegation: false, sortOrder: 5 },
  ];

  // Committees hang off an event, so the seed needs one to exist. Reuse whatever
  // event is already there rather than making a second: the database allows only
  // one active at a time.
  const seedEvent =
    (await prisma.event.findFirst({ orderBy: { createdAt: "desc" } })) ??
    (await prisma.event.create({
      data: { name: "DelTech MUN", slug: "current-event", kind: "CONFERENCE", state: "LIVE" },
    }));

  for (const c of committees) {
    await prisma.committee.upsert({
      where: { eventId_slug: { eventId: seedEvent.id, slug: c.slug } },
      update: {},
      create: { ...c, eventId: seedEvent.id },
    });
  }

  // Fees — delete + recreate (no natural unique key to upsert on)
  await prisma.fee.deleteMany();
  await prisma.fee.createMany({
    data: [
      { label: "Standard",                         committeeType: "STANDARD", isDtu: false, amountInr: 1600 },
      { label: "Double Delegation (UNHRC)",         committeeType: "UNHRC",    isDtu: false, amountInr: 3200 },
      { label: "International Press",               committeeType: "PRESS",    isDtu: false, amountInr: 1400 },
      { label: "Standard (DTU)",                    committeeType: "STANDARD", isDtu: true,  amountInr: 1500 },
      { label: "Double Delegation – DTU (UNHRC)",   committeeType: "UNHRC",    isDtu: true,  amountInr: 3000 },
      { label: "International Press (DTU)",         committeeType: "PRESS",    isDtu: true,  amountInr: 1400 },
    ],
  });

  // Admin users
  const adminEmails: Array<{ email: string; name: string }> = [
    { email: "arnavsinghal06@gmail.com", name: "Arnav Singhal" },
  ];
  if (process.env.ADMIN_EMAIL) {
    adminEmails.push({ email: process.env.ADMIN_EMAIL, name: "Admin" });
  }

  for (const { email, name } of adminEmails) {
    await prisma.user.upsert({
      where: { email },
      update: { role: Role.ADMIN },
      create: { email, name, role: Role.ADMIN },
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
