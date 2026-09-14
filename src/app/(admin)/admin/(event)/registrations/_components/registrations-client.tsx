"use client"

import { formatDate } from "@/lib/datetime"
import { useState, useCallback, useMemo, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Download, ChevronLeft, ChevronRight, Check, Minus, Mail, SlidersHorizontal, X } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn, toSelectItems } from "@/lib/utils"
import type { SerializedDelegate } from "../_lib/types"
import type { SortField } from "../_lib/build-where"
import { draftMailForDelegates } from "../../mailer/actions"
import { DelegateDrawer } from "./delegate-drawer"
import { statusMeta } from "../_lib/status"

interface Committee { id: string; name: string; slug: string }

interface Filters {
  q: string
  committeeId: string
  status: string
  source: string
  isDtu: string
  needsAccommodation: string
  followUp: string
  query: string
  page: number
  perPage: number
  sortBy: SortField
  sortDir: "asc" | "desc"
}

interface Props {
  delegates: SerializedDelegate[]
  committees: Committee[]
  total: number
  filters: Filters
  // Intra MUN: every delegate is a DTU student, so college, DTU, accommodation
  // and source say nothing; the roll number does.
  intra?: boolean
}

const STATUS_OPTIONS = ["REGISTERED", "ALLOTTED", "PAYMENT_SENT", "CONFIRMED", "CANCELLED", "WAITLISTED"]
const SOURCE_OPTIONS = ["SELF", "CROSS_DEL", "SPONSORED", "INTERNAL", "MANUAL"]

const SOURCE_LABEL: Record<string, string> = {
  SELF: "Self", CROSS_DEL: "Cross-del", SPONSORED: "Sponsored", INTERNAL: "Internal", MANUAL: "Manual",
}

const FILTER_KEYS = ["q", "committeeId", "status", "source", "isDtu", "needsAccommodation", "followUp", "query"] as const

function buildUrl(filters: Filters) {
  const p = new URLSearchParams()
  for (const key of FILTER_KEYS) if (filters[key]) p.set(key, filters[key])
  if (filters.page > 1) p.set("page", String(filters.page))
  if (filters.sortBy !== "createdAt") p.set("sortBy", filters.sortBy)
  if (filters.sortDir !== "desc") p.set("sortDir", filters.sortDir)
  const qs = p.toString()
  return `/admin/registrations${qs ? `?${qs}` : ""}`
}

function buildExportUrl(filters: Filters, format: "xlsx" | "csv") {
  const p = new URLSearchParams()
  p.set("format", format)
  for (const key of FILTER_KEYS) if (filters[key]) p.set(key, filters[key])
  return `/api/admin/export?${p.toString()}`
}

function SortHeader({ label, field, currentSort, currentDir, onSort }: {
  label: string; field: SortField; currentSort: SortField; currentDir: "asc" | "desc"
  onSort: (field: SortField, dir: "asc" | "desc") => void
}) {
  const active = currentSort === field
  const nextDir = active && currentDir === "asc" ? "desc" : "asc"
  return (
    <button
      onClick={() => onSort(field, nextDir)}
      className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
    >
      {label}
      {active ? (
        currentDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  )
}

export function RegistrationsClient({ delegates, committees, total, filters, intra = false }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [drafting, startDrafting] = useTransition()
  const [selectedDelegate, setSelectedDelegate] = useState<SerializedDelegate | null>(null)
  const [localDelegates, setLocalDelegates] = useState(delegates)
  const [searchValue, setSearchValue] = useState(filters.q)
  // Ticked rows survive paging, so people can be picked across pages.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // The filters people reach for rarely sit behind one button, open by default only
  // when one of them is already in use.
  const rareKeys = (intra ? ["followUp", "query"] : ["source", "isDtu", "needsAccommodation", "followUp", "query"]) as (keyof Filters)[]
  const rareActive = rareKeys.filter((k) => filters[k]).length
  const anyActive = FILTER_KEYS.some((k) => filters[k])
  const [moreOpen, setMoreOpen] = useState(rareActive > 0)

  // Keep local delegates in sync when server data changes
  // (delegates prop updates on navigation)
  const [prevDelegates, setPrevDelegates] = useState(delegates)
  if (delegates !== prevDelegates) {
    setPrevDelegates(delegates)
    setLocalDelegates(delegates)
    if (selectedDelegate) {
      const updated = delegates.find(d => d.id === selectedDelegate.id)
      if (updated) setSelectedDelegate(updated)
    }
  }

  const committeeItems = useMemo(
    () => [{ value: "", label: "All committees" }, ...toSelectItems(committees, (c) => c.id, (c) => c.name)],
    [committees]
  )

  const navigate = useCallback((newFilters: Partial<Filters>) => {
    startTransition(() => {
      router.replace(buildUrl({ ...filters, page: 1, ...newFilters }), { scroll: false })
    })
  }, [filters, router])

  const handleSort = useCallback((field: SortField, dir: "asc" | "desc") => {
    navigate({ sortBy: field, sortDir: dir, page: 1 })
  }, [navigate])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    navigate({ q: searchValue, page: 1 })
  }

  const draftMail = (input: Parameters<typeof draftMailForDelegates>[0]) =>
    startDrafting(async () => {
      const r = await draftMailForDelegates(input)
      if (!r.success) {
        toast.error(r.error)
        return
      }
      setPicked(new Set())
      router.push(`/admin/mailer/${r.id}`)
    })

  const togglePicked = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const pageIds = localDelegates.map((d) => d.id)
  const pageAllPicked = pageIds.length > 0 && pageIds.every((id) => picked.has(id))
  const togglePage = () =>
    setPicked((prev) => {
      const next = new Set(prev)
      for (const id of pageIds) {
        if (pageAllPicked) next.delete(id)
        else next.add(id)
      }
      return next
    })

  const committeeMap = new Map(committees.map(c => [c.id, c.name]))

  const totalPages = Math.ceil(total / filters.perPage)
  const start = (filters.page - 1) * filters.perPage + 1
  const end = Math.min(filters.page * filters.perPage, total)

  const handleDelegateUpdated = (updated: SerializedDelegate) => {
    setLocalDelegates(prev => prev.map(d => d.id === updated.id ? updated : d))
    setSelectedDelegate(updated)
  }

  const columns: { label: string; field?: SortField; tooltip?: string }[] = [
    { label: "Name", field: "fullName" },
    intra ? { label: "Roll no." } : { label: "Institution", field: "institution" },
    { label: "Seat", tooltip: "The seat they were given, or their first choice while they wait" },
    { label: "Status", field: "status" },
    ...(intra ? [] : [{ label: "Source" }, { label: "DTU", tooltip: "DTU student" }, { label: "Accom.", tooltip: "Needs accommodation" }]),
    { label: "Registered", field: "createdAt" },
  ]

  return (
    <div className="space-y-4">
      {/* Filter bar: every control is h-9, so the row lines up. */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchValue}
              onChange={(e) => {
                setSearchValue(e.target.value)
                if (!e.target.value && filters.q) navigate({ q: "" })
              }}
              placeholder={intra ? "Search name, email, roll no." : "Search name, email, college"}
              aria-label="Search delegates, press Enter"
              className="h-9 w-64 pl-9 text-sm"
            />
          </form>

          <Select value={filters.status || undefined} onValueChange={(v) => navigate({ status: v || "" })}>
            <SelectTrigger size="sm" className="w-40">
              <SelectValue placeholder="Every stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Every stage</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  <span className={cn("size-2 rounded-full", statusMeta(s).dot)} />
                  {statusMeta(s).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select items={committeeItems} value={filters.committeeId || undefined} onValueChange={(v) => navigate({ committeeId: v || "" })}>
            <SelectTrigger size="sm" className="w-44">
              <SelectValue placeholder="Every committee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Every committee</SelectItem>
              {committees.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant={moreOpen || rareActive ? "secondary" : "ghost"} size="sm" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}>
            <SlidersHorizontal className="size-4" />
            {rareActive > 0 ? `More filters · ${rareActive}` : "More filters"}
          </Button>

          {anyActive && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                setSearchValue("")
                navigate(Object.fromEntries(FILTER_KEYS.map((k) => [k, ""])))
              }}
            >
              <X className="size-4" /> Clear
            </Button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={drafting || total === 0}
              onClick={() => draftMail({ filters: Object.fromEntries(FILTER_KEYS.map((k) => [k, filters[k] || undefined])) })}
            >
              <Mail className="size-4" /> {`Email ${anyActive ? "these" : "all"} ${total}`}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                <Download className="size-4" /> Export
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem render={<a href={buildExportUrl(filters, "xlsx")} download />}>Excel (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem render={<a href={buildExportUrl(filters, "csv")} download />}>CSV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {moreOpen && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2">
            <Select value={filters.followUp || undefined} onValueChange={(v) => navigate({ followUp: v || "" })}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue placeholder="Any follow-up" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any follow-up</SelectItem>
                <SelectItem value="due">Follow-up due</SelectItem>
                <SelectItem value="never">Unpaid, never called</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.query || undefined} onValueChange={(v) => navigate({ query: v || "" })}>
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder="Any question" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any question</SelectItem>
                <SelectItem value="open">Unanswered question</SelectItem>
              </SelectContent>
            </Select>
            {!intra && (
              <>
                <Select value={filters.source || undefined} onValueChange={(v) => navigate({ source: v || "" })}>
                  <SelectTrigger size="sm" className="w-40">
                    <SelectValue placeholder="Any source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Any source</SelectItem>
                    {SOURCE_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>{SOURCE_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filters.isDtu || undefined} onValueChange={(v) => navigate({ isDtu: v || "" })}>
                  <SelectTrigger size="sm" className="w-36">
                    <SelectValue placeholder="DTU or not" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">DTU or not</SelectItem>
                    <SelectItem value="true">DTU only</SelectItem>
                    <SelectItem value="false">Not DTU</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filters.needsAccommodation || undefined} onValueChange={(v) => navigate({ needsAccommodation: v || "" })}>
                  <SelectTrigger size="sm" className="w-44">
                    <SelectValue placeholder="Any accommodation" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Any accommodation</SelectItem>
                    <SelectItem value="true">Needs accommodation</SelectItem>
                    <SelectItem value="false">No accommodation</SelectItem>
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
        )}
      </div>

      {picked.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-background px-3 py-2 text-sm shadow-sm">
          <span className="font-medium">{`${picked.size} selected`}</span>
          <Button size="sm" disabled={drafting} onClick={() => draftMail({ ids: [...picked] })}>
            <Mail className="size-4" /> Email selected
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="editorial-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60">
              <th className="w-10 px-4 py-3 text-left">
                <input
                  type="checkbox"
                  aria-label="Select every delegate on this page"
                  checked={pageAllPicked}
                  onChange={togglePage}
                  className="size-4 accent-primary"
                />
              </th>
              {columns.map(({ label, field, tooltip }) => (
                <th key={label} className="px-4 py-3 text-left" title={tooltip}>
                  {field ? (
                    <SortHeader
                      label={label}
                      field={field}
                      currentSort={filters.sortBy}
                      currentDir={filters.sortDir}
                      onSort={handleSort}
                    />
                  ) : (
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {label}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {localDelegates.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No delegates match the current filters.
                </td>
              </tr>
            ) : (
              localDelegates.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => setSelectedDelegate(d)}
                  className={cn("cursor-pointer transition-colors hover:bg-muted/40", picked.has(d.id) && "bg-primary/5")}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${d.fullName}`}
                      checked={picked.has(d.id)}
                      onChange={() => togglePicked(d.id)}
                      className="size-4 accent-primary"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-card-foreground">{d.fullName}</div>
                    <div className="text-xs text-muted-foreground">{d.email}</div>
                  </td>
                  <td className="max-w-40 px-4 py-3">
                    <span className="block truncate text-muted-foreground">{intra ? (d.rollNumber ?? "-") : d.institution}</span>
                  </td>
                  <td className="max-w-60 px-4 py-3">
                    {d.allotment ? (
                      <span className="block truncate font-medium text-card-foreground">{`${committeeMap.get(d.allotment.committeeId) ?? ""} · ${d.allotment.portfolio.name}`}</span>
                    ) : d.pref1CommitteeId ? (
                      <span className="block truncate text-muted-foreground">{`Wants ${committeeMap.get(d.pref1CommitteeId) ?? "-"}${d.pref1Portfolio ? ` · ${d.pref1Portfolio}` : ""}`}</span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", statusMeta(d.status).pill)}>
                      <span className={cn("size-1.5 rounded-full", statusMeta(d.status).dot)} />
                      {statusMeta(d.status).label}
                    </span>
                  </td>
                  {!intra && (<>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground">{SOURCE_LABEL[d.source] ?? d.source}</span>
                  </td>
                  <td className="px-4 py-3">
                    {d.isDtu ? <Check className="size-4 text-primary" /> : <Minus className="size-4 text-muted-foreground/40" />}
                  </td>
                  <td className="px-4 py-3">
                    {d.needsAccommodation ? <Check className="size-4 text-primary" /> : <Minus className="size-4 text-muted-foreground/40" />}
                  </td>
                  </>)}
                  <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground">
                    {formatDate(d.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {total === 0 ? "0 results" : `Showing ${start}–${end} of ${total}`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={filters.page <= 1}
            onClick={() => navigate({ page: filters.page - 1 })}
          >
            <ChevronLeft className="size-3.5" /> Prev
          </Button>
          <span className="px-2 text-xs text-muted-foreground">
            {filters.page} / {totalPages || 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={filters.page >= totalPages}
            onClick={() => navigate({ page: filters.page + 1 })}
          >
            Next <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Delegate drawer */}
      <DelegateDrawer
        delegate={selectedDelegate}
        committees={committees}
        intra={intra}
        onClose={() => setSelectedDelegate(null)}
        onUpdated={handleDelegateUpdated}
      />
    </div>
  )
}
