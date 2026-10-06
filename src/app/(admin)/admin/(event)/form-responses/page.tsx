import { requireStaff } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { currentEventScope, getActiveEvent } from "@/lib/event"
import { sheetBotEmail } from "@/lib/sheet-fetch"
import { t } from "@/content/strings"
import { formatDateTime } from "@/lib/datetime"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { DelegateTabs } from "../registrations/_components/delegate-tabs"
import { INTRA_FORM_MAPPING, type DelegateMapping } from "@/lib/schemas/delegate-import"
import { FormSyncManager } from "./_components/form-sync-manager"
import { QueryList } from "./_components/query-list"

export const dynamic = "force-dynamic"

export default async function FormResponsesPage() {
  await requireStaff()

  const scope = await currentEventScope()
  const [event, sources, queries] = await Promise.all([
    getActiveEvent(),
    // This event's sources only: a tab connected for last year's event is last
    // year's, even when the same Form is reused.
    prisma.delegateSheetSource.findMany({
      where: { isActive: true, ...scope },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        label: true,
        sheetUrl: true,
        sheetKey: true,
        mapping: true,
        lastImportedAt: true,
        lastCheckedAt: true,
        lastCheckRows: true,
        lastCheckNeedsAction: true,
        lastCheckError: true,
        lastAccess: true,
      },
    }),
    prisma.delegate.findMany({
      where: { query: { not: null }, queryResolvedAt: null, NOT: { query: "" }, ...scope },
      orderBy: { createdAt: "asc" },
      select: { id: true, fullName: true, email: true, whatsapp: true, query: true },
      take: 200,
    }),
  ])

  return (
    <div className="space-y-8">
      <DelegateTabs />
      <PageHeader eyebrow="Delegates" title={t("admin.formSync.title")} description={t("admin.formSync.description")} />

      <FormSyncManager
        sources={sources.map((s) => ({
          id: s.id,
          label: s.label,
          sheetUrl: s.sheetUrl,
          sheetKey: s.sheetKey,
          mapping: (s.mapping ?? {}) as Partial<DelegateMapping>,
          lastImported: s.lastImportedAt ? formatDateTime(s.lastImportedAt) : null,
          lastChecked: s.lastCheckedAt ? formatDateTime(s.lastCheckedAt) : null,
          lastCheckRows: s.lastCheckRows,
          lastCheckNeedsAction: s.lastCheckNeedsAction,
          lastCheckError: s.lastCheckError,
          lastAccess: s.lastAccess,
        }))}
        eventName={event?.name ?? ""}
        bot={sheetBotEmail()}
        // A volunteer connecting the Intra form for the first time sees it already
        // matched; they confirm, they do not build.
        defaultMapping={INTRA_FORM_MAPPING}
      />

      <QueryList queries={queries.map((q) => ({ id: q.id, name: q.fullName, email: q.email, phone: q.whatsapp, query: q.query ?? "" }))} />
    </div>
  )
}
