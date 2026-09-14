import { cache } from "react"
import { prisma } from "@/lib/prisma"
import { mappedRowSchema, type MappedRow } from "@/lib/schemas/import"
import type { Source, Prisma } from "@/generated/prisma/client"
import { currentEventScope, requireActiveEvent } from "@/lib/event"

// ---------------------------------------------------------------------------
// Deterministic normalizers, run before (and independently of) any AI pass.
// One pipeline, three entrances: import wizard, gform webhook, cron re-sync.
// ---------------------------------------------------------------------------

const EMAIL_TYPO_MAP: [RegExp, string][] = [
  [/@(gmial|gmal|gamil|gmaill|gnail)\./i, "@gmail."],
  [/@(yahooo|yaho)\./i, "@yahoo."],
  [/@(redifmail|redimail)\./i, "@rediffmail."],
  [/@(outloo|otlook|outlok)\./i, "@outlook."],
  [/@(hotmal|homail|hotmial)\./i, "@hotmail."],
]

export function normalizeEmail(s: string): string {
  let email = s.replace(/\s+/g, "").toLowerCase()
  for (const [re, fix] of EMAIL_TYPO_MAP) email = email.replace(re, fix)
  return email
}

const PHONE_JUNK = /^(n\/?a|nil|none|same( as above)?|-*)$/i

export function normalizePhone(s: string | undefined): string | undefined {
  if (!s || PHONE_JUNK.test(s.trim())) return undefined
  const digits = s.replace(/\D/g, "")
  if (digits.length === 10) return `91${digits}`
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`
  if (digits.length === 12 && digits.startsWith("91")) return digits
  if (digits.length >= 10) return digits
  return undefined
}

const HONORIFIC = /^(mr|ms|mrs|dr|prof|er|ar|adv|ca)\.?\s+/i

export function normalizeName(s: string): string {
  const stripped = s.trim().replace(/\s+/g, " ").replace(HONORIFIC, "")
  return stripped
    .split(" ")
    .map((w) => (w.length <= 3 && w === w.toUpperCase() && /^[A-Z.]+$/.test(w)
      ? w // keep initials/abbreviations like "MD." or "K."
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ")
}

export interface CommitteeRef {
  id: string
  name: string
  slug: string
  aliases: string[]
}

// exact name → alias → slug → case-insensitive name. No fuzzy guessing here;
// anything unresolved is left for the AI pass (wizard) or the quarantine.
export function matchCommittee(input: string | undefined, committees: CommitteeRef[]): CommitteeRef | undefined {
  if (!input) return undefined
  const q = input.trim().toLowerCase()
  if (!q) return undefined
  return (
    committees.find((c) => c.name.toLowerCase() === q) ??
    committees.find((c) => c.aliases.some((a) => a.trim().toLowerCase() === q)) ??
    committees.find((c) => c.slug.toLowerCase() === q)
  )
}

export interface NormalizedRow {
  row: MappedRow
  // committee inputs that didn't resolve to a known committee (per pref slot)
  unresolved: string[]
}

export function normalizeRow(input: MappedRow, committees: CommitteeRef[]): NormalizedRow {
  const unresolved: string[] = []

  const resolve = (name: string | undefined): string | undefined => {
    if (!name?.trim()) return undefined
    const match = matchCommittee(name, committees)
    if (!match) {
      unresolved.push(name.trim())
      return name.trim()
    }
    return match.name
  }

  return {
    row: {
      fullName: normalizeName(input.fullName ?? ""),
      email: normalizeEmail(input.email ?? ""),
      whatsapp: normalizePhone(input.whatsapp),
      institution: input.institution?.trim() || undefined,
      committee: resolve(input.committee),
      portfolio: input.portfolio?.trim() || undefined,
      committee2: resolve(input.committee2),
      portfolio2: input.portfolio2?.trim() || undefined,
      committee3: resolve(input.committee3),
      portfolio3: input.portfolio3?.trim() || undefined,
      note: input.note?.trim() || undefined,
    },
    unresolved,
  }
}

// Deduped per request. createDelegateFromRow calls this as its first line, and
// its callers loop: a 300-row import fired 300 identical committee queries, and
// the nightly gform sync did the same for every row of every sheet.
export const getCommitteeRefs = cache(async (): Promise<CommitteeRef[]> => {
  // The running event's committees: a name must never resolve to a closed event's room.
  return prisma.committee.findMany({
    where: { isActive: true, ...(await currentEventScope()) },
    select: { id: true, name: true, slug: true, aliases: true },
  })
})

// ---------------------------------------------------------------------------
// Row → Delegate (single write path for every intake channel)
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient

async function tryAllot(
  tx: Tx,
  delegateId: string,
  allottedBy: string,
  prefs: { committee?: string; portfolio?: string }[],
): Promise<boolean> {
  for (const { committee, portfolio } of prefs) {
    if (!committee || !portfolio) continue

    const comm = await tx.committee.findFirst({
      where: { name: { equals: committee, mode: "insensitive" }, isActive: true, ...(await currentEventScope()) },
      select: { id: true },
    })
    if (!comm) continue

    const port = await tx.portfolio.findFirst({
      where: {
        committeeId: comm.id,
        name: { equals: portfolio, mode: "insensitive" },
        status: "AVAILABLE",
      },
      select: { id: true },
    })
    if (!port) continue

    await tx.allotment.create({
      data: { delegateId, committeeId: comm.id, portfolioId: port.id, allottedBy },
    })
    await tx.portfolio.update({ where: { id: port.id }, data: { status: "ALLOTTED" } })
    return true
  }
  return false
}

export type CreateRowResult =
  | { ok: true; delegateId: string; allotted: boolean }
  | { ok: false; reason: "duplicate" | "invalid"; errors: string[]; quarantinedId?: string }

function isP2002(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002"
}

// Which unique index did we collide with? Two very different failures both
// surface as P2002 here and used to be reported identically as "duplicate":
//
//   Delegate.email      this person really is already registered. Skipping is right.
//   Allotment.portfolioId  another row took the same portfolio a moment earlier.
//                          The whole transaction rolls back, so this delegate is
//                          never created at all, and calling that a duplicate
//                          means a real (often paid) registration is dropped with
//                          no quarantine row and no error anyone ever sees.
function conflictTarget(err: unknown): string {
  const meta = (err as { meta?: { target?: unknown } })?.meta?.target
  if (Array.isArray(meta)) return meta.join(",")
  return typeof meta === "string" ? meta : ""
}

// Creates a Delegate from a normalized row. CROSS_DEL rows are CONFIRMED and
// auto-allotted from up to 3 preferences; everything else lands REGISTERED
// and goes through the normal allotment flow. Invalid rows are quarantined,
// never silently dropped. The unique email index is the dedup guard.
export async function createDelegateFromRow(
  input: MappedRow,
  source: Source,
  opts: { sourceNote?: string; allottedBy?: string; presetName?: string } = {},
): Promise<CreateRowResult> {
  const committees = await getCommitteeRefs()
  const { row } = normalizeRow(input, committees)

  const parsed = mappedRowSchema.safeParse(row)
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
    const q = await prisma.quarantinedRow.create({
      data: {
        source,
        presetName: opts.presetName,
        raw: row as unknown as Prisma.InputJsonValue,
        errors,
      },
    })
    return { ok: false, reason: "invalid", errors, quarantinedId: q.id }
  }

  // Every delegate belongs to an event. Automatic intake is already gated on
  // registration being open, which cannot be true without one, so this is the
  // backstop rather than the message anybody should see.
  const event = await requireActiveEvent()
  const isCrossDel = source === "CROSS_DEL"
  const committeeId = (name?: string) => matchCommittee(name, committees)?.id ?? null

  try {
    const { delegateId, allotted } = await prisma.$transaction(async (tx) => {
      const d = await tx.delegate.create({
        data: {
          eventId: event.id,
          fullName: row.fullName,
          email: row.email,
          whatsapp: row.whatsapp ?? row.email,
          institution: row.institution ?? "N/A",
          isDtu: false,
          source,
          sourceNote: [opts.sourceNote, row.note].filter(Boolean).join(" · ") || null,
          status: isCrossDel ? "CONFIRMED" : "REGISTERED",
          pref1CommitteeId: committeeId(row.committee),
          pref1Portfolio: row.portfolio ?? null,
          pref2CommitteeId: committeeId(row.committee2),
          pref2Portfolio: row.portfolio2 ?? null,
          pref3CommitteeId: committeeId(row.committee3),
          pref3Portfolio: row.portfolio3 ?? null,
        },
      })

      const didAllot = isCrossDel
        ? await tryAllot(tx, d.id, opts.allottedBy ?? `intake:${source.toLowerCase()}`, [
            { committee: row.committee, portfolio: row.portfolio },
            { committee: row.committee2, portfolio: row.portfolio2 },
            { committee: row.committee3, portfolio: row.portfolio3 },
          ])
        : false

      return { delegateId: d.id, allotted: didAllot }
    })

    if (allotted) {
      const { syncSheetForDelegate } = await import("@/lib/sheet-sync")
      await syncSheetForDelegate(delegateId)
    }

    return { ok: true, delegateId, allotted }
  } catch (err) {
    if (isP2002(err)) {
      const target = conflictTarget(err)

      // Portfolio contention, not a duplicate person. The transaction rolled
      // back so this delegate does not exist; quarantine the row so a human
      // can re-run it against a different portfolio instead of losing it.
      if (target.includes("portfolioId")) {
        const errors = [
          `Portfolio already taken by another row in this batch; ${row.email} was not created`,
        ]
        const q = await prisma.quarantinedRow.create({
          data: {
            source,
            presetName: opts.presetName,
            raw: row as unknown as Prisma.InputJsonValue,
            errors,
          },
        })
        return { ok: false, reason: "invalid", errors, quarantinedId: q.id }
      }

      return { ok: false, reason: "duplicate", errors: [`${row.email} already registered`] }
    }
    throw err
  }
}
