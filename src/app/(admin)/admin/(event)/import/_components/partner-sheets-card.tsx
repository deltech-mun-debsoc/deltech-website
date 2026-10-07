"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { FileSpreadsheet, Plus, Trash2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { deriveCsvUrl } from "@/lib/gsheet-url"
import { formatDateTime } from "@/lib/datetime"
import type { SheetPullHealth } from "@/lib/sheet-pull"
import { readPartnerSheet, savePartnerSheets, type PartnerSheet } from "../actions"
import type { WizardStart } from "./import-wizard"

interface Props {
  sources:     PartnerSheet[]
  presetNames: string[]
  health:      Record<string, SheetPullHealth>
  bot:         string | null
  // Hands a sheet's rows to the same review an uploaded file gets.
  onReview:    (start: WizardStart) => void
}

// A delegation's own Google Sheet, read every night by /api/cron/gform-sync.
// Rows it can read are accepted; anything unclear waits under Needs fixing.
// "Review now" puts the sheet through the same review as an uploaded file.
export function PartnerSheetsCard({ sources, presetNames, health, bot, onReview }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [url, setUrl] = useState("")
  const [preset, setPreset] = useState(presetNames[0] ?? "")

  const save = (next: PartnerSheet[], done?: string) =>
    startTransition(async () => {
      const result = await savePartnerSheets(next)
      if (!result.success) {
        toast.error(result.error ?? "Failed to save.")
        return
      }
      if (done) toast.success(done)
      router.refresh()
    })

  const add = () => {
    if (!preset) {
      toast.error("Upload this delegation's file once and save its column matching as a preset first.")
      return
    }
    const csvUrl = deriveCsvUrl(url)
    if (!csvUrl) {
      toast.error("That doesn't look like a Google Sheets link.")
      return
    }
    save([...sources.filter((s) => s.presetName !== preset), { presetName: preset, csvUrl, source: "CROSS_DEL" }], "Sheet connected.")
    setUrl("")
  }

  const review = (presetName: string) =>
    startTransition(async () => {
      const result = await readPartnerSheet(presetName)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      onReview({ headers: result.headers, rows: result.rows, mapping: result.mapping })
    })

  return (
    <div className="editorial-card space-y-5 p-6">
      {sources.length > 0 && (
        <ul className="space-y-2">
          {sources.map((s) => {
            const h = health[s.presetName]
            return (
              <li key={s.presetName} className="space-y-2 rounded-md border border-border/60 bg-background p-3">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{s.presetName}</p>
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => review(s.presetName)}>
                    Review now
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                    title="Disconnect"
                    disabled={isPending}
                    onClick={() => save(sources.filter((x) => x.presetName !== s.presetName))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {h
                    ? `Last read automatically ${formatDateTime(h.at)} · ${h.rows} rows · ${h.created} new · ${h.quarantined} need fixing`
                    : "Not read automatically yet. It is read once a night."}
                </p>
                {h?.error && (
                  <p className="flex items-start gap-2 text-xs text-destructive">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    {h.error}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {bot
            ? `Share the delegation's sheet with ${bot} as a Viewer, then connect it here. It is read every night, and you can review it now.`
            : `The sheet must be open to anyone with the link, which exposes the names and phones in it. It is read every night, and you can review it now.`}
        </p>
        <div className="space-y-1.5">
          <Label className="text-xs">Google Sheets link</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Column matching (preset)</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v ?? "")}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="No presets yet" />
              </SelectTrigger>
              <SelectContent>
                {presetNames.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" className="gap-1.5" disabled={isPending || !url.trim()} onClick={add}>
            <Plus className="size-3.5" /> Connect
          </Button>
        </div>
      </div>
    </div>
  )
}
