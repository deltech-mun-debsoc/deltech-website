import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { automaticIntakeAllowed } from "@/lib/event-state"
import { getContent } from "@/lib/settings"
import { createDelegateFromRow, normalizeEmail, normalizePhone, normalizeName } from "@/lib/intake"
import { applyMapping, type ColumnMapping } from "@/lib/schemas/import"
import { rowHash } from "@/lib/recruitment/import"
import { parseCycleConfig } from "@/lib/schemas/recruitment"

// Google Form → site intake. An Apps Script onFormSubmit trigger POSTs each
// response here (docs/apps-script/gform-webhook.gs). Missed webhooks self-heal
// via /api/cron/gform-sync. Always returns 200 for handled rows (duplicate or
// quarantined included) so Apps Script only alerts on real failures.

function secretOk(header: string | null): boolean {
  const secret = process.env.GFORM_SHARED_SECRET ?? ""
  if (!secret || !header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

interface GformBody {
  preset?: string
  kind: "delegate" | "applicant"
  source?: "SELF" | "CROSS_DEL"
  row: Record<string, string>
}

// Tolerant header matching for applicant forms, no preset needed.
function pickColumn(row: Record<string, string>, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const key = Object.keys(row).find((k) => pattern.test(k))
    if (key && row[key]?.trim()) return row[key].trim()
  }
  return undefined
}

// Live push from the recruitment form. Candidates are cycle-scoped now, so a
// response that arrives with no cycle accepting intake is quarantined rather than
// dropped: it can be replayed once a cycle opens.
async function handleApplicant(row: Record<string, string>): Promise<NextResponse> {
  const fullName = pickColumn(row, [/full ?name/i, /^name$/i, /your name/i])
  const email = pickColumn(row, [/e-?mail/i])
  const phone = pickColumn(row, [/phone|whatsapp|mobile|contact/i])
  const year = pickColumn(row, [/year|batch/i])
  const branch = pickColumn(row, [/branch|department|course/i])

  if (!fullName || !email) {
    await prisma.quarantinedRow.create({
      data: { source: "RECRUITMENT_CANDIDATE", raw: row, errors: ["Missing name or email column"] },
    })
    return NextResponse.json({ ok: true, quarantined: true })
  }

  // Only DRAFT and OPEN cycles take new form responses; a cycle already running
  // its GDs should not have people appearing mid-round.
  const cycle = await prisma.recruitmentCycle.findFirst({
    where: { state: { in: ["DRAFT", "OPEN"] } },
    orderBy: [{ openedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, config: true },
  })
  if (!cycle) {
    await prisma.quarantinedRow.create({
      data: {
        source: "RECRUITMENT_CANDIDATE",
        raw: row,
        errors: ["No recruitment cycle is accepting responses right now."],
      },
    })
    return NextResponse.json({ ok: true, quarantined: true })
  }

  const config = parseCycleConfig(cycle.config)
  const normalizedEmail = normalizeEmail(email)

  try {
    await prisma.recruitmentCandidate.create({
      data: {
        cycleId: cycle.id,
        fullName: normalizeName(fullName),
        email: normalizedEmail,
        phone: normalizePhone(phone) ?? null,
        year: year ?? null,
        branch: branch ?? null,
        formAnswers: row,
        // Marks the webhook as the origin so a later sheet import can match this
        // row by email and take ownership of it instead of duplicating it.
        sourceSheetKey: "gform-webhook",
        sourceRowKey: `email:${normalizedEmail}`,
        sourceRowHash: rowHash(row),
        importedAt: new Date(),
        gdRequired: config.stages.gdRequiredByDefault,
        piRequired: config.stages.piRequiredByDefault,
      },
    })
  } catch (err) {
    // Already in this cycle: the form was submitted twice, or the sheet import
    // got there first. Both are fine.
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002") {
      return NextResponse.json({ ok: true, dedup: true })
    }
    throw err
  }
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  if (!secretOk(req.headers.get("x-gform-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: GformBody
  try {
    body = (await req.json()) as GformBody
    if (!body?.row || typeof body.row !== "object") throw new Error("bad row")
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (body.kind === "applicant") {
    return handleApplicant(body.row)
  }

  // kind === "delegate": map columns through the named ImportPreset
  if (!body.preset) {
    return NextResponse.json({ error: "preset is required for delegate intake" }, { status: 400 })
  }
  const preset = await prisma.importPreset.findUnique({ where: { name: body.preset } })
  if (!preset) {
    return NextResponse.json({ error: `Unknown preset "${body.preset}"` }, { status: 400 })
  }

  const source = body.source === "CROSS_DEL" ? "CROSS_DEL" : "SELF"

  // Refused rows are kept, not dropped: if registration was closed by mistake,
  // or reopens, an organiser can still find and retry the submission.
  const gate = automaticIntakeAllowed(await getContent(), source)
  if (!gate.ok) {
    await prisma.quarantinedRow.create({
      data: { source, presetName: body.preset, raw: body.row as object, errors: [gate.reason] },
    })
    return NextResponse.json({ ok: true, quarantined: true, reason: gate.reason })
  }

  const mapped = applyMapping(body.row, preset.mapping as ColumnMapping)
  const result = await createDelegateFromRow(mapped, source, {
    sourceNote: `gform:${body.preset}`,
    allottedBy: `gform:${body.preset}`,
    presetName: body.preset,
  })

  if (!result.ok) {
    // duplicate and quarantined are both handled states. 200 so the
    // Apps Script doesn't alert; the quarantine list surfaces them to staff.
    return NextResponse.json({ ok: true, [result.reason]: true })
  }

  if (source === "SELF") {
    void import("@/lib/resend")
      .then(({ sendRegistrationEmails }) => sendRegistrationEmails(result.delegateId))
      .catch((err) => console.error(`[gform] registration emails failed for ${result.delegateId}:`, err))
  } else if (result.allotted) {
    void import("@/lib/resend")
      .then(({ sendAllotmentEmail }) => sendAllotmentEmail(result.delegateId))
      .catch((err) => console.error(`[gform] allotment email failed for ${result.delegateId}:`, err))
  }

  return NextResponse.json({ ok: true, delegateId: result.delegateId, allotted: result.allotted })
}
