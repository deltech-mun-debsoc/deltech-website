import { prisma } from "@/lib/prisma"
import { getContent } from "@/lib/settings"
import { currentEventScope } from "@/lib/event"
import { getImportPresets, getQuarantine } from "./actions"
import { ImportWizard } from "./_components/import-wizard"
import { QuarantinePanel } from "./_components/quarantine-panel"
import { PartnerSheetsCard } from "./_components/partner-sheets-card"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { DelegateTabs } from "../registrations/_components/delegate-tabs"

export default async function ImportPage() {
  const [presets, committees, quarantine, content] = await Promise.all([
    getImportPresets(),
    // This event's committees only: a sheet is matched against the event being run.
    prisma.committee.findMany({
      where:   { isActive: true, ...(await currentEventScope()) },
      select:  { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    getQuarantine(),
    getContent(),
  ])

  return (
    <div className="space-y-6">
      <DelegateTabs />
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          eyebrow="Delegates"
          title="Partner sheets"
          description="Upload a partner sheet, map their columns to our fields, review, and import. Google Form intake lands here automatically, only broken rows need you."
        />
        {/* id so the import wizard's completion screen can link straight here */}
        <div id="quarantine" className="scroll-mt-20">
          <QuarantinePanel rows={quarantine} />
        </div>
        <ImportWizard presets={presets} committeeNames={committees.map((c) => c.name)} />
        <PartnerSheetsCard
          sources={content.sheetPullSources}
          presetNames={presets.map((p) => p.name)}
        />
      </div>
    </div>
  )
}
