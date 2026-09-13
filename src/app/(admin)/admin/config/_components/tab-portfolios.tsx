"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Download, Pencil, Plus, Sheet as SheetIcon, Sparkles, Trash2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { addPortfolio, bulkAddPortfolios, deletePortfolio, generatePortfolios, readPortfolioSheet, updatePortfolio } from "../actions"
import { lineFor, parseDraft } from "../_lib/draft-lines"
import type { ClientCommittee, ClientPortfolio } from "../_lib/types"

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available", ON_HOLD: "On hold", ALLOTTED: "Allotted", BLOCKED: "Blocked",
}

export function TabPortfolios({ committees }: { committees: ClientCommittee[] }) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState(committees[0]?.id ?? "")
  const [newName, setNewName] = useState("")
  const [newTag, setNewTag] = useState("")
  const [draft, setDraft] = useState("")
  const [brief, setBrief] = useState("")
  const [sheetUrl, setSheetUrl] = useState("")
  const [sourceNote, setSourceNote] = useState("")
  const [genSize, setGenSize] = useState(36)
  const [editing, setEditing] = useState<ClientPortfolio | null>(null)
  const [editName, setEditName] = useState("")
  const [editTag, setEditTag] = useState("")
  const [isPending, startTransition] = useTransition()
  const selected = useMemo(() => committees.find((c) => c.id === selectedId), [committees, selectedId])
  const tagLabel = selected?.portfolioTagLabel || "Classification"

  const switchCommittee = (id: string) => {
    setSelectedId(id)
    const next = committees.find((committee) => committee.id === id)
    setBrief(next?.matrixBrief ?? "")
    setDraft("")
    setSourceNote("")
    setSheetUrl("")
  }

  const handleGenerate = () => startTransition(async () => {
    if (!selectedId) return
    const result = await generatePortfolios(selectedId, genSize, brief)
    if (!result.success || !result.portfolios) { toast.error(result.error ?? "Generation failed."); return }
    setDraft(result.portfolios.map(lineFor).join("\n"))
    setSourceNote(result.sourceNote ?? "Verify time-sensitive facts before publishing.")
    toast.success(`Drafted ${result.portfolios.length} ranked portfolios. Nothing has been saved yet.`)
  })

  // The society keeps its matrix in a spreadsheet, so this reads that tab straight
  // into the same review box the AI draft lands in. Nothing is saved here: publishing
  // stays the one deliberate step.
  const handleLoadSheet = () => startTransition(async () => {
    if (!selectedId || !sheetUrl.trim()) return
    const result = await readPortfolioSheet(sheetUrl.trim())
    if (!result.success || !result.entries) { toast.error(result.error ?? "Could not read that sheet."); return }
    setDraft(result.entries.map(lineFor).join("\n"))
    // Seats already filled in by hand in the sheet are invisible once the names are
    // parsed, so say so. The matrix here is the seat list, not the allotments.
    const notes = [
      `Read ${result.entries.length} from the ${result.nameColumn} column`,
      result.tagColumn ? `tags from ${result.tagColumn}` : null,
      result.duplicates ? `${result.duplicates} duplicate rows skipped` : null,
      result.alreadyAllotted ? `${result.alreadyAllotted} already allotted in the sheet` : null,
    ].filter(Boolean).join(" · ")
    setSourceNote(notes)
    toast.success(`${notes}. Nothing has been saved yet.`)
  })

  const handlePublish = () => startTransition(async () => {
    const entries = parseDraft(draft)
    if (!selectedId || entries.length === 0) return
    const result = await bulkAddPortfolios(selectedId, entries)
    toast.success(`Published ${result.added}${result.skipped ? ` · ${result.skipped} duplicates skipped` : ""}.`)
    setDraft("")
    router.refresh()
  })

  const handleAdd = () => startTransition(async () => {
    const result = await addPortfolio(selectedId, newName, newTag)
    if (!result.success) { toast.error(result.error ?? "Could not add portfolio."); return }
    setNewName(""); setNewTag(""); router.refresh(); toast.success("Portfolio added.")
  })

  const beginEdit = (portfolio: ClientPortfolio) => {
    setEditing(portfolio); setEditName(portfolio.name); setEditTag(portfolio.tag ?? "")
  }

  const saveEdit = () => startTransition(async () => {
    if (!editing) return
    const result = await updatePortfolio(editing.id, { name: editName, tag: editTag, priority: editing.priority })
    if (!result.success) { toast.error(result.error ?? "Could not save."); return }
    setEditing(null); router.refresh(); toast.success("Portfolio updated.")
  })

  const remove = (id: string) => startTransition(async () => {
    const result = await deletePortfolio(id)
    if (!result.success) { toast.error(result.error ?? "Could not remove portfolio."); return }
    router.refresh(); toast.success("Portfolio removed.")
  })

  if (committees.length === 0) return <p className="text-base text-muted-foreground">Create a committee before building its matrix.</p>

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 border-y border-border py-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <Label>Working committee</Label>
          <Select value={selectedId} onValueChange={(value) => switchCommittee(value ?? "")}>
            <SelectTrigger className="h-12 w-full text-base md:w-96">
              <span className="truncate">{selected?.name ?? "Choose a committee"}</span>
            </SelectTrigger>
            <SelectContent>{committees.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.portfolios.length}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <a className={buttonVariants({ variant: "outline" })} href={`/api/admin/export?entity=matrix&committeeId=${selectedId}&format=csv`}><Download /> CSV</a>
          <a className={buttonVariants({ variant: "outline" })} href={`/api/admin/export?entity=matrix&committeeId=${selectedId}&format=xlsx`}><Download /> Excel</a>
        </div>
      </div>

      {selected && <div className="grid gap-8 xl:grid-cols-[0.8fr_1.2fr]">
        <section className="space-y-5 bg-muted/40 p-6">
          <div><p className="eyebrow">Research brief</p><h3 className="mt-2 font-heading text-2xl">Tell it what matters now</h3></div>
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={7} placeholder={selected.matrixBrief || "State the current scenario, actors, blocs, and exclusions. Example: prioritize sitting HRC members and agenda-affected states."} />
          <div className="flex items-end gap-3">
            <div className="space-y-2"><Label htmlFor="matrix-size">Seats</Label><Input id="matrix-size" type="number" min={1} max={300} value={genSize} onChange={(e) => setGenSize(Number(e.target.value) || 36)} className="h-11 w-24" /></div>
            <Button onClick={handleGenerate} disabled={isPending} className="h-11 flex-1"><Sparkles />{isPending ? "Thinking…" : "Generate ranked draft"}</Button>
          </div>
          <div className="space-y-2 border-t border-border pt-5">
            <Label htmlFor="matrix-sheet">Or load the matrix from a sheet</Label>
            <div className="flex gap-2">
              <Input id="matrix-sheet" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/..." className="h-11 flex-1" />
              <Button variant="outline" onClick={handleLoadSheet} disabled={isPending || !sheetUrl.trim()} className="h-11"><SheetIcon />{isPending ? "Reading…" : "Load"}</Button>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">Seats are ranked by relevance to the agenda, never padded out alphabetically. Crisis committees take no reporters, and the tag column follows whatever this committee calls its classification.</p>
        </section>

        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4"><div><p className="eyebrow">Review queue</p><h3 className="mt-2 font-heading text-2xl">Correct before publishing</h3></div><Badge variant="outline">Name | {tagLabel} | Rank</Badge></div>
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={14} className="font-mono text-sm leading-7" placeholder={`India | Member | 1\nUnited States | Non-member | 2`} />
          {sourceNote && <p className="border-l-2 border-gold-500 pl-4 text-sm leading-relaxed text-muted-foreground"><strong className="text-foreground">Verification note:</strong> {sourceNote}</p>}
          <div className="flex justify-end"><Button onClick={handlePublish} disabled={isPending || !draft.trim()}><Plus /> Publish reviewed draft</Button></div>
        </section>
      </div>}

      {selected && <section className="border-t-4 border-foreground pt-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div><p className="eyebrow">Published matrix</p><h3 className="mt-2 font-heading text-2xl">{selected.portfolios.length} seats in {selected.name}</h3></div>
          <div className="grid gap-2 sm:grid-cols-[1fr_0.7fr_auto]"><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Country or person" /><Input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder={tagLabel} /><Button onClick={handleAdd} disabled={isPending || !newName.trim()}><Plus /> Add</Button></div>
        </div>
        <div className="mt-6 overflow-x-auto border-y border-border">
          <table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Rank</th><th className="px-4 py-3">Portfolio</th><th className="px-4 py-3">{tagLabel}</th><th className="px-4 py-3">State</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-border">{selected.portfolios.slice().sort((a,b) => (a.priority || 999) - (b.priority || 999) || a.name.localeCompare(b.name)).map((p) => <tr key={p.id}>
              <td className="px-4 py-3 font-mono text-muted-foreground">{p.priority || "-"}</td>
              <td className="px-4 py-3 font-semibold">{editing?.id === p.id ? <Input value={editName} onChange={(e) => setEditName(e.target.value)} /> : p.name}</td>
              <td className="px-4 py-3">{editing?.id === p.id ? <Input value={editTag} onChange={(e) => setEditTag(e.target.value)} /> : <Badge variant="secondary">{p.tag || "Unclassified"}</Badge>}</td>
              <td className="px-4 py-3">{STATUS_LABEL[p.status] ?? p.status}</td>
              <td className="px-4 py-3 text-right">{editing?.id === p.id ? <div className="flex justify-end gap-2"><Button size="sm" onClick={saveEdit}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div> : <div className="flex justify-end gap-1"><Button size="icon" variant="ghost" onClick={() => beginEdit(p)} aria-label={`Edit ${p.name}`}><Pencil /></Button>{p.status === "AVAILABLE" && <Button size="icon" variant="ghost" onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`}><Trash2 /></Button>}</div>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}
    </div>
  )
}
