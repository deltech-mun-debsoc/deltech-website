import { formatDateTime } from "@/lib/datetime"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { RecruitmentDenied, requireRecruitmentAccess, requireRecruitmentAction, mayPerform, resolveCycleContext } from "@/lib/recruitment/authz"
import { t } from "@/content/strings"
import { Card } from "@/components/ui/card"
import { RecruitmentPageHeader } from "../../_components/page-header"
import { LiveRefresh } from "@/components/recruitment/live-refresh"
import { ResponsesManager } from "../_components/responses-manager"
import { candidateMappingSchema } from "@/lib/schemas/recruitment"

// The Form Responses page: replaces the old admin recruitment sheet-sync button.
// Configure a source, map its columns, preview exactly what will change, then
// import. Re-importing identical content is a no-op.
export default async function ResponsesPage() {
  const { cycle } = await requireRecruitmentAccess()
  if (!cycle) return null

  // Reading this page requires the preview capability, so a JC is redirected rather
  // than shown an import surface they cannot use.
  try {
    await requireRecruitmentAction(cycle.id, "import.preview")
  } catch (err) {
    if (err instanceof RecruitmentDenied) redirect("/recruitment")
    throw err
  }

  const ctx = await resolveCycleContext(cycle.id)
  if (!ctx) redirect("/recruitment")

  const [sources, imports] = await Promise.all([
    prisma.recruitmentSheetSource.findMany({
      where: { cycleId: cycle.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, label: true, sheetUrl: true, sheetKey: true, mapping: true, isActive: true },
    }),
    prisma.recruitmentImport.findMany({
      where: { cycleId: cycle.id },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: {
        id: true,
        state: true,
        rowsTotal: true,
        rowsCreated: true,
        rowsUpdated: true,
        rowsSkipped: true,
        rowsInvalid: true,
        errors: true,
        startedAt: true,
        finishedAt: true,
        importedById: true,
      },
    }),
  ])

  return (
    <div className="space-y-6">
      <LiveRefresh cycleId={cycle.id} />

      <RecruitmentPageHeader
        eyebrow={cycle.name}
        title={t("recruitment.responses.title")}
        description={t("recruitment.responses.description")}
      />

      <ResponsesManager
        cycleId={cycle.id}
        canConfigure={mayPerform(ctx, "import.configure")}
        canApply={mayPerform(ctx, "import.apply")}
        sources={sources.map((s) => ({
          id: s.id,
          label: s.label,
          sheetUrl: s.sheetUrl,
          sheetKey: s.sheetKey,
          isActive: s.isActive,
          mapping: candidateMappingSchema.safeParse(s.mapping).data ?? {},
        }))}
      />

      <section className="space-y-3">
        <h2 className="section-label">
          {t("recruitment.responses.lastImport")}
        </h2>
        {imports.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("recruitment.responses.never")}</p>
        ) : (
          <ul className="space-y-2">
            {imports.map((i) => {
              const errors = Array.isArray(i.errors)
                ? (i.errors as { rowIndex: number; reason: string }[])
                : []
              return (
                <li key={i.id}>
                  <Card className="space-y-2 p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>
                        {t("recruitment.responses.importedResult", {
                          created: i.rowsCreated,
                          updated: i.rowsUpdated,
                          skipped: i.rowsSkipped,
                          invalid: i.rowsInvalid,
                        })}
                      </span>
                      <time
                        className="text-xs text-muted-foreground"
                        dateTime={(i.finishedAt ?? i.startedAt).toISOString()}
                      >
                        {formatDateTime((i.finishedAt ?? i.startedAt))}
                      </time>
                    </div>
                    {/* Rejected rows are shown, not dropped. */}
                    {errors.length > 0 && (
                      <ul className="space-y-0.5 text-xs text-muted-foreground">
                        {errors.slice(0, 8).map((e, idx) => (
                          <li key={idx}>
                            #{e.rowIndex + 1}: {e.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
