import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import * as XLSX from "xlsx"
import { buildDelegateWhere } from "@/app/(admin)/admin/registrations/_lib/build-where"
import { resolveCycleContext } from "@/lib/recruitment/authz"
import { can } from "@/lib/recruitment/permissions"

// Excel's worksheet tab name, not the download filename: it may be at most 31
// characters and may not contain : \ / ? * [ ]. `name` here has always been
// built as `${prefix}-${cycle.slug}`, and slugs run up to 60 chars (see
// cycleSlugSchema) -- so a real cycle sails past the limit and XLSX.write
// throws, while the CSV branch below never touches a sheet name at all. That
// asymmetry is what let this ship invisibly: CSV always worked, so nobody
// caught XLSX being the one broken format. Slugs are validated to
// lowercase/digits/hyphens only, so length is the only real threat here, but
// the forbidden characters are stripped too rather than assumed away.
export function safeSheetName(name: string): string {
  const stripped = name.replace(/[:\\/?*[\]]/g, "").slice(0, 31)
  return stripped || "sheet"
}

function sheetResponse(
  rows: Record<string, string | number>[],
  format: "csv" | "xlsx",
  name: string,
) {
  const ws = XLSX.utils.json_to_sheet(rows)

  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(ws)
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
      },
    })
  }

  const wb = XLSX.utils.book_new()
  // The download filename keeps the full descriptive name -- only the sheet
  // tab is constrained.
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName(name))
  const buf = XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string
  const binary = Buffer.from(buf, "base64")
  return new NextResponse(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}.xlsx"`,
    },
  })
}

// Recruitment candidates for one cycle (or the most recent cycle when none is
// given). Aggregated GD/PI scores are computed from the SUBMITTED evaluations
// rather than read off the candidate row: there is no single score column any
// more, because a panel can have several evaluators.
async function exportCandidates(
  format: "csv" | "xlsx",
  status?: string | null,
  cycleId?: string | null,
) {
  const cycle = cycleId
    ? await prisma.recruitmentCycle.findUnique({ where: { id: cycleId }, select: { id: true, slug: true } })
    : await prisma.recruitmentCycle.findFirst({
        orderBy: [{ openedAt: "desc" }, { createdAt: "desc" }],
        select: { id: true, slug: true },
      })
  if (!cycle) return sheetResponse([], format, "candidates")

  const candidates = await prisma.recruitmentCandidate.findMany({
    where: {
      cycleId: cycle.id,
      ...(status === "SELECTED" ? { result: "SELECTED" } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: {
      evaluations: {
        where: { state: "SUBMITTED" },
        select: { kind: true, overall: true, recommendation: true },
      },
      handoffs: { where: { bypass: true, reversedAt: null }, select: { reason: true }, take: 1 },
    },
  })

  const mean = (values: number[]) =>
    values.length === 0 ? "" : Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2))

  const rows = candidates.map((c) => {
    const gd = c.evaluations.filter((e) => e.kind === "GD" && e.overall !== null).map((e) => e.overall!)
    const pi = c.evaluations.filter((e) => e.kind === "PI" && e.overall !== null).map((e) => e.overall!)
    return {
      "Full Name": c.fullName,
      Email: c.email,
      Phone: c.phone ?? "",
      Year: c.year ?? "",
      Branch: c.branch ?? "",
      Stage: c.stage,
      Result: c.result,
      "GD Score (avg)": mean(gd),
      "GD Evaluators": gd.length,
      "GD Bypassed": c.handoffs.length > 0 ? "Yes" : "No",
      "GD Bypass Reason": c.handoffs[0]?.reason ?? "",
      "PI Score (avg)": mean(pi),
      "PI Evaluators": pi.length,
      "Society Role": c.societyRole ?? "",
      Recruited: c.recruitedAt ? c.recruitedAt.toISOString() : "",
      "Applied At": c.createdAt.toISOString(),
    }
  })

  return sheetResponse(
    rows,
    format,
    status === "SELECTED" ? `selected-${cycle.slug}` : `candidates-${cycle.slug}`,
  )
}

async function exportMatrix(format: "csv" | "xlsx", committeeId?: string | null) {
  const portfolios = await prisma.portfolio.findMany({
    where: committeeId ? { committeeId } : undefined,
    orderBy: [{ committee: { sortOrder: "asc" } }, { priority: "asc" }, { name: "asc" }],
    include: {
      committee: true,
      allotment: { include: { delegate: { include: { payment: true } } } },
    },
  })
  const rows = portfolios.map((portfolio) => ({
    Committee: portfolio.committee.name,
    Agenda: portfolio.committee.agenda ?? "",
    Portfolio: portfolio.name,
    [portfolio.committee.portfolioTagLabel || "Classification"]: portfolio.tag ?? "",
    Rank: portfolio.priority || "",
    Status: portfolio.status,
    Delegate: portfolio.allotment?.delegate.fullName ?? "",
    Email: portfolio.allotment?.delegate.email ?? "",
    "Registration status": portfolio.allotment?.delegate.status ?? "",
    "Payment status": portfolio.allotment?.delegate.payment?.status ?? "Not required / not created",
  }))
  return sheetResponse(rows, format, "portfolio-matrix")
}

export async function GET(request: NextRequest) {
  const session = await auth()
  const role = (session?.user as { role?: string } | undefined)?.role
  const isDashboardStaff = !!session && (role === "ADMIN" || role === "MAINTAINER")

  const sp = request.nextUrl.searchParams
  const format = sp.get("format") === "csv" ? "csv" : "xlsx"

  // "applicants" is kept as an alias so existing bookmarks and the operator guide
  // keep working after the recruitment refactor.
  if (sp.get("entity") === "candidates" || sp.get("entity") === "applicants") {
    // Recruitment authority is per-cycle and independent of the dashboard role: a
    // recruitment ADMIN can be a SUB_MAINTAINER app account, which this route used
    // to refuse outright. Either door opens it.
    //
    // The recruitment door used to require MAINTAINER+, on the theory that a JC's
    // candidate list was scoped to their own panels and exporting a partial cycle
    // as if it were the whole thing would be worse than refusing. The candidates
    // page (candidates/page.tsx) dropped that scoping: every recruitment role,
    // JC included, now sees and is shown an "Export all" button for the full
    // cycle. This door was never updated to match, so a JC's own export button
    // 401'd every time -- the fix is the same test the page already uses,
    // candidate.view, which every recruitment role holds.
    const cycleId = sp.get("cycleId")
    const recruitmentCtx = cycleId ? await resolveCycleContext(cycleId) : null
    const isRecruitmentStaff = can(recruitmentCtx?.role, "candidate.view")
    if (!isDashboardStaff && !isRecruitmentStaff) {
      return new NextResponse("Unauthorized", { status: 401 })
    }
    return exportCandidates(format, sp.get("status"), cycleId)
  }

  if (!isDashboardStaff) {
    return new NextResponse("Unauthorized", { status: 401 })
  }
  if (sp.get("entity") === "matrix") {
    return exportMatrix(format, sp.get("committeeId"))
  }

  const delegates = await prisma.delegate.findMany({
    where: buildDelegateWhere({
      q: sp.get("q") ?? undefined,
      committeeId: sp.get("committeeId") ?? undefined,
      status: sp.get("status") ?? undefined,
      source: sp.get("source") ?? undefined,
      isDtu: sp.get("isDtu") ?? undefined,
      needsAccommodation: sp.get("needsAccommodation") ?? undefined,
    }),
    orderBy: { createdAt: "desc" },
    include: { coDelegate: true },
  })

  const rows = delegates.map((d) => ({
    "Full Name": d.fullName,
    Email: d.email,
    WhatsApp: d.whatsapp,
    "Alt Phone": d.altPhone ?? "",
    Institution: d.institution,
    DTU: d.isDtu ? "Yes" : "No",
    "MUN Experience": d.munExperience ?? "",
    "Pref1 Committee ID": d.pref1CommitteeId ?? "",
    "Pref1 Portfolio": d.pref1Portfolio ?? "",
    "Pref2 Committee ID": d.pref2CommitteeId ?? "",
    "Pref2 Portfolio": d.pref2Portfolio ?? "",
    "Needs Accommodation": d.needsAccommodation ? "Yes" : "No",
    "Outside NCR": d.outsideNcr ? "Yes" : "No",
    Status: d.status,
    Source: d.source,
    Reference: d.reference ?? "",
    "Registered At": d.createdAt.toISOString(),
    "Co-delegate Name": d.coDelegate?.fullName ?? "",
    "Co-delegate Email": d.coDelegate?.email ?? "",
    "Co-delegate Phone": d.coDelegate?.phone ?? "",
  }))

  const ws = XLSX.utils.json_to_sheet(rows)

  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(ws)
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="delegates.csv"',
      },
    })
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Delegates")
  const buf = XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string
  const binary = Buffer.from(buf, "base64")

  return new NextResponse(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="delegates.xlsx"',
    },
  })
}
