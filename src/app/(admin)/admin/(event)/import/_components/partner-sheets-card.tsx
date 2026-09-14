"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2, FileSpreadsheet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { deriveCsvUrl } from "@/lib/gsheet-url"
import { saveContent } from "../../config/actions"

interface Source {
  presetName: string
  csvUrl: string
  source: "SELF" | "CROSS_DEL"
}

interface Props {
  sources: Source[]
  presetNames: string[]
}

// Recurring partners' Google Sheets, synced daily by /api/cron/gform-sync.
export function PartnerSheetsCard({ sources, presetNames }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [url, setUrl] = useState("")
  const [preset, setPreset] = useState(presetNames[0] ?? "")
  const [srcType, setSrcType] = useState<"SELF" | "CROSS_DEL">("CROSS_DEL")

  const save = (next: Source[]) =>
    startTransition(async () => {
      const result = await saveContent({ sheetPullSources: next })
      if (result.success) {
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed to save.")
      }
    })

  const add = () => {
    if (!preset) {
      toast.error("Create an import preset first (in the wizard above).")
      return
    }
    const csvUrl = deriveCsvUrl(url)
    if (!csvUrl) {
      toast.error("That doesn't look like a Google Sheets link.")
      return
    }
    save([...sources.filter((s) => s.presetName !== preset), { presetName: preset, csvUrl, source: srcType }])
    setUrl("")
    toast.success("Partner sheet added, syncs daily.")
  }

  const remove = (presetName: string) => save(sources.filter((s) => s.presetName !== presetName))

  return (
    <div className="editorial-card p-6">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="size-4 text-muted-foreground" />
        <h2 className="font-heading text-lg">Partner sheets</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Paste a partner&apos;s Google Sheet, it auto-imports every day, no wizard needed.
        The sheet must be &quot;anyone with the link can view&quot;, or published to the web.
      </p>
      <div className="rule my-5" />

      {sources.length > 0 && (
        <ul className="mb-5 space-y-2">
          {sources.map((s) => (
            <li
              key={s.presetName}
              className="flex items-center gap-3 rounded-md border border-border/60 bg-background px-3 py-2"
            >
              <Badge variant="outline" className="text-[10px]">
                {s.source === "CROSS_DEL" ? "Cross-del" : "Self"}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.presetName}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{s.csvUrl}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-destructive"
                disabled={isPending}
                onClick={() => remove(s.presetName)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Google Sheets link</Label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
          />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Preset (column mapping)</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v ?? "")}>
              <SelectTrigger className="w-48">
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
          <div className="space-y-1.5">
            <Label className="text-xs">Source</Label>
            <Select value={srcType} onValueChange={(v) => setSrcType(v as "SELF" | "CROSS_DEL")}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CROSS_DEL">Cross-del</SelectItem>
                <SelectItem value="SELF">Self</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" className="gap-1.5" disabled={isPending || !url.trim()} onClick={add}>
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
      </div>
    </div>
  )
}
