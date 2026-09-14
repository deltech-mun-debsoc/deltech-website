interface Row {
  name: string
  total: number
  allotted: number
}

export function CommitteeFillTable({ data }: { data: Row[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No committees configured.</p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <th className="pb-3 pr-4">Committee</th>
            <th className="pb-3 pr-4 text-right">Allotted</th>
            <th className="pb-3 pr-4 text-right">Total</th>
            <th className="w-44 pb-3">Fill rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {data.map((row) => {
            const pct =
              row.total > 0 ? Math.round((row.allotted / row.total) * 100) : 0
            return (
              <tr key={row.name}>
                <td className="py-3 pr-4 font-medium text-card-foreground">
                  {row.name}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                  {row.allotted}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                  {row.total}
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {pct}%
                    </span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
