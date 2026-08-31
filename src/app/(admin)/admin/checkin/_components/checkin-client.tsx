"use client"

import { formatDateTime } from "@/lib/datetime"
import { useCallback, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"
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
import { toSelectItems } from "@/lib/utils"
import { t } from "@/content/strings"
import { checkInDelegate, undoCheckIn } from "../actions"

export interface CheckinDelegate {
  id: string
  fullName: string
  email: string
  institution: string
  status: string
  isDtu: boolean
  needsAccommodation: boolean
  checkedInAt: string | null
  checkedInBy: string | null
  committeeName: string | null
  portfolioName: string | null
  paymentStatus: string | null
}

interface Filters {
  q: string
  status: string
}

interface Props {
  delegates: CheckinDelegate[]
  filters: Filters
  capped?: boolean
}

const STATUS_OPTIONS = ["REGISTERED", "ALLOTTED", "PAYMENT_SENT", "CONFIRMED", "CANCELLED", "WAITLISTED"]

const STATUS_LABEL: Record<string, string> = {
  REGISTERED: "Registered", ALLOTTED: "Allotted", PAYMENT_SENT: "Pay link sent",
  CONFIRMED: "Confirmed", CANCELLED: "Cancelled", WAITLISTED: "Waitlisted",
}
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  REGISTERED: "secondary", ALLOTTED: "outline", PAYMENT_SENT: "outline",
  CONFIRMED: "default", CANCELLED: "destructive", WAITLISTED: "secondary",
}
const PAY_STATUS_LABEL: Record<string, string> = {
  PENDING: "Awaiting payment", SENT: "Payment link sent", PAID: "Paid",
  OFFLINE: "Confirmed (UPI)", COMPED: "Comped", FAILED: "Payment failed",
}

function buildUrl(filters: Filters) {
  const p = new URLSearchParams()
  if (filters.q) p.set("q", filters.q)
  if (filters.status) p.set("status", filters.status)
  const qs = p.toString()
  return `/admin/checkin${qs ? `?${qs}` : ""}`
}

export function CheckinClient({ delegates, filters, capped }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [searchValue, setSearchValue] = useState(filters.q)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const statusItems = useMemo(
    () => [{ value: "", label: "All statuses" }, ...toSelectItems(STATUS_OPTIONS, (s) => s, (s) => STATUS_LABEL[s])],
    []
  )

  const navigate = useCallback((newFilters: Partial<Filters>) => {
    startTransition(() => {
      router.replace(buildUrl({ ...filters, ...newFilters }), { scroll: false })
    })
  }, [filters, router])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    navigate({ q: searchValue })
  }

  const handleCheckIn = (id: string) => {
    setPendingId(id)
    startTransition(async () => {
      await checkInDelegate(id)
      router.refresh()
      setPendingId(null)
    })
  }

  const handleUndo = (id: string) => {
    setPendingId(id)
    startTransition(async () => {
      await undoCheckIn(id)
      router.refresh()
      setPendingId(null)
    })
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-2">
        <form onSubmit={handleSearchSubmit} className="flex gap-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={t("checkin.searchPlaceholder")}
              className="h-8 w-64 pl-8 text-sm"
            />
          </div>
          <Button type="submit" size="sm" variant="secondary" className="h-8">
            {t("common.search")}
          </Button>
        </form>

        <Select
          items={statusItems}
          value={filters.status || undefined}
          onValueChange={(v) => navigate({ status: v || "" })}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder={t("checkin.statusPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {capped && (
        <p className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          Showing the first {delegates.length} matches. Search by name, email or institution to
          narrow it down.
        </p>
      )}

      {/* Table */}
      <div className="editorial-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60">
              {[
                t("admin.table.headerName"),
                t("admin.table.headerCommittee"),
                t("checkin.headerPortfolio"),
                t("admin.table.headerStatus"),
                t("admin.table.headerPayStatus"),
                t("admin.table.headerActions"),
              ].map((label) => (
                <th key={label} className="px-4 py-3 text-left">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {delegates.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {t("empty.noResults")}
                </td>
              </tr>
            ) : (
              delegates.map((d) => (
                <tr key={d.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <div className="font-medium text-card-foreground">{d.fullName}</div>
                    <div className="text-xs text-muted-foreground">{d.email}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{d.committeeName ?? "-"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{d.portfolioName ?? "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={STATUS_VARIANT[d.status] ?? "secondary"}>
                        {STATUS_LABEL[d.status] ?? d.status}
                      </Badge>
                      {d.status !== "CONFIRMED" && (
                        <Badge variant="outline">{t("checkin.notConfirmedBadge")}</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {d.paymentStatus ? (PAY_STATUS_LABEL[d.paymentStatus] ?? d.paymentStatus) : "-"}
                  </td>
                  <td className="px-4 py-3">
                    {d.checkedInAt ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {t("checkin.checkedInAt", { time: formatDateTime(d.checkedInAt), by: d.checkedInBy ?? "-" })}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pendingId === d.id}
                          onClick={() => handleUndo(d.id)}
                        >
                          {t("checkin.undoButton")}
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" disabled={pendingId === d.id} onClick={() => handleCheckIn(d.id)}>
                        {t("checkin.checkInButton")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
