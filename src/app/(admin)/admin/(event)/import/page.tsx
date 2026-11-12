import { prisma } from "@/lib/prisma"
import { getContent } from "@/lib/settings"
import { redirect } from "next/navigation"
import { currentEventScope, getEventCapabilities } from "@/lib/event"
import { getImportPresets, getQuarantine } from "./actions"
import { QuarantinePanel } from "./_components/quarantine-panel"
import { IntakeChooser } from "./_components/intake-chooser"
import { sheetBotEmail } from "@/lib/sheet-fetch"
import { parseSheetPullHealth, SHEET_PULL_HEALTH } from "@/lib/sheet-pull"
import { deserializeSettingValue } from "@/lib/setting-value"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { DelegateTabs } from "../registrations/_components/delegate-tabs"

export default async function ImportPage() {
  // Before anything is uploaded or analysed: an event that takes no cross
  // delegations never reaches the wizard, rather than being refused at the end.
  if (!(await getEventCapabilities()).crossDelegations) redirect("/admin/registrations")

  const [presets, committees, quarantine, content, healthRow] = await Promise.all([
    getImportPresets(),
    // This event's committees only: a sheet is matched against the event being run.
    prisma.committee.findMany({
      where:   { isActive: true, ...(await currentEventScope()) },
      select:  { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    getQuarantine(),
    getContent(),
    prisma.setting.findUnique({ where: { key: SHEET_PULL_HEALTH } }),
  ])

  return (
    <div className="space-y-6">
      <DelegateTabs />
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          eyebrow="Delegates"
          title="Cross delegations"
          description="Delegates sent by other colleges, from a file they send or their own Google Sheet. Both go through the same review; anything unclear waits under Needs fixing."
        />
        {/* id so the import wizard's completion screen can link straight here */}
        <div id="quarantine" className="scroll-mt-20">
          <QuarantinePanel rows={quarantine} committeeNames={committees.map((c) => c.name)} />
        </div>
        <IntakeChooser
          presets={presets}
          committeeNames={committees.map((c) => c.name)}
          sources={content.sheetPullSources}
          health={parseSheetPullHealth(healthRow ? deserializeSettingValue(healthRow.value) : undefined)}
          bot={sheetBotEmail()}
        />
      </div>
    </div>
  )
}
