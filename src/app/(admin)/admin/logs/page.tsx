import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/authz"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { LogsClient } from "./_components/logs-client"

const PAGE_SIZE = 100

export default async function LogsPage(props: {
  searchParams: Promise<{ actor?: string; entity?: string; action?: string; page?: string }>
}) {
  const session = await requireStaff()
  const { actor, entity, action, page } = await props.searchParams

  // Was a hard take: 100 with no way to reach anything older. On a busy
  // allotment day that is a few hours of trail, and the audit log is the only
  // record of who changed what.
  const pageNum = Math.max(1, Number.parseInt(page ?? "1", 10) || 1)

  const where = {
    ...(actor ? { actorEmail: { contains: actor, mode: "insensitive" as const } } : {}),
    ...(entity ? { entity: { equals: entity, mode: "insensitive" as const } } : {}),
    ...(action ? { action: { contains: action, mode: "insensitive" as const } } : {}),
  }

  const [logs, total, rollbacks] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { at: "desc" },
      skip: (pageNum - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where: { action: "audit.rollback", entity: "AuditLog", entityId: { not: null } },
      select: { entityId: true },
    }),
  ])
  const rolledBackIds = new Set(rollbacks.flatMap((row) => row.entityId ? [row.entityId] : []))

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const qs = (p: number) => {
    const sp = new URLSearchParams()
    if (actor) sp.set("actor", actor)
    if (entity) sp.set("entity", entity)
    if (action) sp.set("action", action)
    if (p > 1) sp.set("page", String(p))
    const q = sp.toString()
    return q ? `/admin/logs?${q}` : "/admin/logs"
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System"
        title="Activity log"
      />

      {/* GET-form filters, no client state needed */}
      <form className="flex flex-wrap gap-2" method="get">
        {/* Re-filtering must start from the first page, not keep an out-of-range one. */}
        <input
          name="actor"
          defaultValue={actor ?? ""}
          placeholder="Filter by actor email…"
          className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
        />
        <input
          name="action"
          defaultValue={action ?? ""}
          placeholder="Action (e.g. delegate.cancel)…"
          className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
        />
        <input
          name="entity"
          defaultValue={entity ?? ""}
          placeholder="Entity (Delegate, Post…)"
          className="h-9 w-44 rounded-md border border-input bg-background px-3 text-sm"
        />
        <button
          type="submit"
          className="h-9 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-muted"
        >
          Filter
        </button>
      </form>

      {logs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          No log entries match.
        </div>
      ) : (
        <LogsClient
          canRollback={(session.user as { role?: string }).role === "ADMIN"}
          logs={logs.map((log) => ({
            ...log,
            at: log.at.toISOString(),
            rolledBack: rolledBackIds.has(log.id),
          }))}
        />
      )}

      {total > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {(pageNum - 1) * PAGE_SIZE + 1}
            {"–"}
            {Math.min(pageNum * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            {pageNum > 1 && (
              <Link
                href={qs(pageNum - 1)}
                className="rounded-md border border-input px-3 py-1.5 hover:bg-muted"
              >
                Newer
              </Link>
            )}
            {pageNum < totalPages && (
              <Link
                href={qs(pageNum + 1)}
                className="rounded-md border border-input px-3 py-1.5 hover:bg-muted"
              >
                Older
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
