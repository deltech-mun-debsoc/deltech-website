import { cache } from "react"
import { prisma } from "@/lib/prisma"
import { COMMITTEE_FIELDS, committeeKey, mappedRowSchema, type CommitteeField, type MappedRow } from "@/lib/schemas/import"
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

// What a typed committee answer means, without guessing.
//
//   match      one committee, by name, alias or slug, ignoring case, spaces and
//              punctuation ("unga disec" is UNGA-DISEC)
//   ambiguous  more than one committee claims it (two committees sharing an
//              alias). Nothing is picked: the first one in query order used to
//              win silently.
//   none       nothing claims it. `suggestions` are near spellings a person can
//              accept; they are never applied on their own.
export type CommitteeResolution =
  | { kind: "match"; committee: CommitteeRef }
  | { kind: "ambiguous"; candidates: CommitteeRef[] }
  | { kind: "none"; suggestions: CommitteeRef[] }

export { committeeKey }

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

export function resolveCommittee(input: string | undefined, committees: CommitteeRef[]): CommitteeResolution {
  const q = committeeKey(input ?? "")
  if (!q) return { kind: "none", suggestions: [] }
  const names = (c: CommitteeRef) => [c.name, c.slug, ...c.aliases].map(committeeKey).filter(Boolean)

  // A committee's own name outranks another committee's alias.
  const byName = committees.filter((c) => committeeKey(c.name) === q)
  if (byName.length === 1) return { kind: "match", committee: byName[0] }
  const claimed = committees.filter((c) => names(c).includes(q))
  if (claimed.length === 1) return { kind: "match", committee: claimed[0] }
  if (claimed.length > 1) return { kind: "ambiguous", candidates: claimed }

  const near = committees.filter((c) =>
    names(c).some((n) => (q.length >= 3 && (n.startsWith(q) || q.startsWith(n))) || (q.length >= 4 && editDistance(q, n) <= 2)),
  )
  return { kind: "none", suggestions: near }
}

// Only a single, certain match. An ambiguous or unknown answer is left for a
// person (the import review) or the quarantine, never settled by query order.
export function matchCommittee(input: string | undefined, committees: CommitteeRef[]): CommitteeRef | undefined {
  const r = resolveCommittee(input, committees)
  return r.kind === "match" ? r.committee : undefined
}

// The same alias on two committees makes every answer naming it ambiguous.
// Returns the first collision as a sentence, or null. Compared the way answers
// are matched: ignoring case, spaces and punctuation.
export function aliasCollision(
  committee: { id?: string; name: string; slug?: string; aliases: string[] },
  others: CommitteeRef[],
): string | null {
  for (const label of [committee.name, committee.slug ?? "", ...committee.aliases]) {
    const k = committeeKey(label)
    if (!k) continue
    const clash = others.find((o) => o.id !== committee.id && [o.name, o.slug, ...o.aliases].some((n) => committeeKey(n) === k))
    if (clash) return `"${label}" already names ${clash.name}. Each name or alias can point to one committee only.`
  }
  return null
}

// A cross-delegation row after cleaning. _suggest is the AI's reading of a
// committee answer nothing else could match: shown beside the original answer for
// a person to accept, never written into the row by itself.
export type CleanedRow = MappedRow & { _note?: string; _skip?: boolean; _suggest?: Partial<Record<CommitteeField, string>> }

// Folds the AI's cleanup into a deterministically cleaned row. Committee answers
// stay exactly as they were: a committee the AI names becomes a suggestion only
// when it is one of ours and the answer matched nothing. A null from the AI
// never erases anything.
export function mergeAiRow(
  before: CleanedRow,
  r: Partial<Record<keyof MappedRow | "_note", string | null>> & { _skip?: boolean | null },
  committees: CommitteeRef[],
): CleanedRow {
  const suggest: Partial<Record<CommitteeField, string>> = {}
  for (const f of COMMITTEE_FIELDS) {
    const text = before[f]
    const said = r[f]
    const named = said ? committees.find((c) => c.name.toLowerCase() === said.trim().toLowerCase()) : undefined
    if (text && named && !matchCommittee(text, committees)) suggest[f] = named.name
  }
  return {
    fullName: r.fullName || before.fullName,
    email: r.email || before.email,
    whatsapp: r.whatsapp ?? before.whatsapp,
    institution: r.institution ?? before.institution,
    committee: before.committee,
    portfolio: r.portfolio ?? before.portfolio,
    committee2: before.committee2,
    portfolio2: r.portfolio2 ?? before.portfolio2,
    committee3: before.committee3,
    portfolio3: r.portfolio3 ?? before.portfolio3,
    note: r.note ?? before.note,
    _note: [before._note, r._note].filter(Boolean).join(", ") || undefined,
    _skip: r._skip === true || before._skip,
    ...(Object.keys(suggest).length ? { _suggest: suggest } : {}),
  }
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
  const { row, unresolved } = normalizeRow(input, committees)

  const parsed = mappedRowSchema.safeParse(row)
  // A committee answer that names none of ours (or more than one) waits for a
  // person instead of being dropped: the choice would be lost, and a cross
  // delegate would be accepted without the seat they asked for.
  const errors = [
    ...(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)),
    ...unresolved.map((name) => `committee: did not resolve (${name})`),
  ]
  if (errors.length > 0) {
    // The same bad row from a nightly re-read is one entry, not one per night.
    const already = await prisma.quarantinedRow.findFirst({
      where: { source, resolvedAt: null, raw: { equals: row as unknown as Prisma.InputJsonValue } },
      select: { id: true },
    })
    const q =
      already ??
      (await prisma.quarantinedRow.create({
        data: {
          source,
          presetName: opts.presetName,
          raw: row as unknown as Prisma.InputJsonValue,
          errors,
        },
        select: { id: true },
      }))
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
