import { requireStaff } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { t } from "@/content/strings"
import { formatDateTime } from "@/lib/datetime"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { INTRA_FORM_MAPPING, type DelegateMapping } from "@/lib/schemas/delegate-import"
import { FormSyncManager } from "./_components/form-sync-manager"
import { QueryList } from "./_components/query-list"

export const dynamic = "force-dynamic"

export default async function FormResponsesPage() {
  await requireStaff()

  const [sources, queries] = await Promise.all([
    prisma.delegateSheetSource.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, label: true, sheetUrl: true, sheetKey: true, mapping: true, lastImportedAt: true },
    }),
    prisma.delegate.findMany({
      where: { query: { not: null }, queryResolvedAt: null, NOT: { query: "" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, fullName: true, email: true, whatsapp: true, query: true },
      take: 200,
    }),
  ])

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t("admin.nav.registrations")} title={t("admin.formSync.title")} description={t("admin.formSync.description")} />

      <FormSyncManager
        sources={sources.map((s) => ({
          id: s.id,
          label: s.label,
          sheetUrl: s.sheetUrl,
          sheetKey: s.sheetKey,
          mapping: (s.mapping ?? {}) as Partial<DelegateMapping>,
          lastImported: s.lastImportedAt ? formatDateTime(s.lastImportedAt) : null,
        }))}
        // A volunteer connecting the Intra form for the first time sees it already
        // matched; they confirm, they do not build.
        defaultMapping={INTRA_FORM_MAPPING}
      />

      <QueryList queries={queries.map((q) => ({ id: q.id, name: q.fullName, email: q.email, phone: q.whatsapp, query: q.query ?? "" }))} />
    </div>
  )
}
