"use client"

import { formatDate } from "@/lib/datetime"
import { useState, useCallback, useMemo, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Download, ChevronLeft, ChevronRight, Check, Minus, Mail } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
}

const STATUS_OPTIONS = ["REGISTERED", "ALLOTTED", "PAYMENT_SENT", "CONFIRMED", "CANCELLED", "WAITLISTED"]
const SOURCE_OPTIONS = ["SELF", "CROSS_DEL", "SPONSORED", "INTERNAL", "MANUAL"]

const STATUS_LABEL: Record<string, string> = {
  REGISTERED: "Registered", ALLOTTED: "Allotted", PAYMENT_SENT: "Pay link sent",
  CONFIRMED: "Confirmed", CANCELLED: "Cancelled", WAITLISTED: "Waitlisted",
}
const SOURCE_LABEL: Record<string, string> = {
  SELF: "Self", CROSS_DEL: "Cross-del", SPONSORED: "Sponsored", INTERNAL: "Internal", MANUAL: "Manual",
}
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  REGISTERED: "secondary", ALLOTTED: "outline", PAYMENT_SENT: "outline",
  CONFIRMED: "default", CANCELLED: "destructive", WAITLISTED: "secondary",
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

export function RegistrationsClient({ delegates, committees, total, filters }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [drafting, startDrafting] = useTransition()
  const [selectedDelegate, setSelectedDelegate] = useState<SerializedDelegate | null>(null)
  const [localDelegates, setLocalDelegates] = useState(delegates)
  const [searchValue, setSearchValue] = useState(filters.q)
  // Ticked rows survive paging, so people can be picked across pages.
  const [picked, setPicked] = useState<Set<string>>(new Set())

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

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-2">
        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="flex gap-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchValue}
              onChange={e => setSearchValue(e.target.value)}
              placeholder="Name, email, institution…"
              className="h-8 w-56 pl-8 text-sm"
            />
          </div>
          <Button type="submit" size="sm" variant="secondary" className="h-8">
            Search
          </Button>
        </form>

        {/* Committee filter */}
        <Select
          items={committeeItems}
          value={filters.committeeId || undefined}
          onValueChange={(v) => navigate({ committeeId: v || "" })}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="All committees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All committees</SelectItem>
            {committees.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status filter */}
        <Select
          value={filters.status || undefined}
          onValueChange={(v) => navigate({ status: v || "" })}
        >
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All statuses</SelectItem>
            {STATUS_OPTIONS.map(s => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Source filter */}
        <Select
          value={filters.source || undefined}
          onValueChange={(v) => navigate({ source: v || "" })}
        >
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All sources</SelectItem>
            {SOURCE_OPTIONS.map(s => (
              <SelectItem key={s} value={s}>{SOURCE_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* DTU filter */}
        <Select
          value={filters.isDtu || undefined}
          onValueChange={(v) => navigate({ isDtu: v || "" })}
        >
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue placeholder="DTU" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All</SelectItem>
            <SelectItem value="true">DTU only</SelectItem>
            <SelectItem value="false">Non-DTU</SelectItem>
          </SelectContent>
        </Select>

        {/* Accommodation filter */}
        <Select
          value={filters.needsAccommodation || undefined}
          onValueChange={(v) => navigate({ needsAccommodation: v || "" })}
        >
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue placeholder="Accom." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All</SelectItem>
            <SelectItem value="true">Needs accom.</SelectItem>
            <SelectItem value="false">No accom.</SelectItem>
          </SelectContent>
        </Select>

        {/* Payment chase */}
        <Select
          value={filters.followUp || undefined}
          onValueChange={(v) => navigate({ followUp: v || "" })}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Follow-up" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All</SelectItem>
            <SelectItem value="due">Follow-up due</SelectItem>
            <SelectItem value="never">Unpaid, never called</SelectItem>
          </SelectContent>
        </Select>

        {/* Questions left on the registration form */}
        <Select
          value={filters.query || undefined}
          onValueChange={(v) => navigate({ query: v || "" })}
        >
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="Questions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All</SelectItem>
            <SelectItem value="open">Unanswered question</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={drafting || total === 0}
            onClick={() => draftMail({ filters: Object.fromEntries(FILTER_KEYS.map((k) => [k, filters[k] || undefined])) })}
          >
            <Mail className="size-3.5" /> {`Email all ${total}`}
          </Button>
          <a href={buildExportUrl(filters, "xlsx")} download>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Download className="size-3.5" /> XLSX
            </Button>
          </a>
          <a href={buildExportUrl(filters, "csv")} download>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Download className="size-3.5" /> CSV
            </Button>
          </a>
        </div>
      </div>

      {picked.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">{`${picked.size} selected`}</span>
          <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={drafting} onClick={() => draftMail({ ids: [...picked] })}>
            <Mail className="size-3.5" /> Email selected
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setPicked(new Set())}>
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
              {[
                { label: "Name", field: "fullName" as SortField },
                { label: "Institution", field: "institution" as SortField },
                { label: "Pref 1" },
                { label: "Status", field: "status" as SortField },
                { label: "Source" },
                { label: "DTU", tooltip: "DTU student" },
                { label: "Accom.", tooltip: "Needs accommodation" },
                { label: "Registered", field: "createdAt" as SortField },
              ].map(({ label, field, tooltip }) => (
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
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">
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
                    <span className="block truncate text-muted-foreground">{d.institution}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {d.pref1CommitteeId ? (committeeMap.get(d.pref1CommitteeId) ?? "-") : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[d.status] ?? "secondary"}>
                      {STATUS_LABEL[d.status] ?? d.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground">{SOURCE_LABEL[d.source] ?? d.source}</span>
                  </td>
                  <td className="px-4 py-3">
                    {d.isDtu ? <Check className="size-4 text-primary" /> : <Minus className="size-4 text-muted-foreground/40" />}
                  </td>
                  <td className="px-4 py-3">
                    {d.needsAccommodation ? <Check className="size-4 text-primary" /> : <Minus className="size-4 text-muted-foreground/40" />}
                  </td>
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
            className="h-8 gap-1"
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
            className="h-8 gap-1"
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
        onClose={() => setSelectedDelegate(null)}
        onUpdated={handleDelegateUpdated}
      />
    </div>
  )
}
