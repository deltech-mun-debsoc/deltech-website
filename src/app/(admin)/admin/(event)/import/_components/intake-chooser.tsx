"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import type { SheetPullHealth } from "@/lib/sheet-pull"
import type { ImportPresetRecord, PartnerSheet } from "../actions"
import { ImportWizard, type WizardStart } from "./import-wizard"
import { PartnerSheetsCard } from "./partner-sheets-card"

// Two ways a delegation arrives, one review. The upload wizard and the linked
// sheet form used to sit on the page together and read like one feature.
export function IntakeChooser({
  presets,
  committeeNames,
  sources,
  health,
  bot,
}: {
  presets: ImportPresetRecord[]
  committeeNames: string[]
  sources: PartnerSheet[]
  health: Record<string, SheetPullHealth>
  bot: string | null
}) {
  const [mode, setMode] = useState<"upload" | "sheet">(sources.length > 0 ? "sheet" : "upload")
  const [start, setStart] = useState<{ key: number; value: WizardStart } | null>(null)

  const tab = (value: "upload" | "sheet", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value && !start}
      onClick={() => {
        setStart(null)
        setMode(value)
      }}
      className={cn(
        "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
        mode === value && !start ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-lg border border-border p-0.5" role="tablist">
        {tab("upload", "Upload a file")}
        {tab("sheet", "Partner sheets")}
      </div>
      {start ? (
        <ImportWizard key={start.key} presets={presets} committeeNames={committeeNames} start={start.value} />
      ) : mode === "upload" ? (
        <ImportWizard presets={presets} committeeNames={committeeNames} />
      ) : (
        <PartnerSheetsCard
          sources={sources}
          presetNames={presets.map((p) => p.name)}
          health={health}
          bot={bot}
          onReview={(value) => setStart({ key: Date.now(), value })}
        />
      )}
    </div>
  )
}
