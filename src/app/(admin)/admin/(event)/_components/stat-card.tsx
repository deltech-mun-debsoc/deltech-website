import { type LucideIcon } from "lucide-react"
import { CountUpValue } from "./count-up-value"

interface Props {
  title: string
  value: string | number
  icon: LucideIcon
  description?: string
  trend?: string
}

export function StatCard({ title, value, icon: Icon, description, trend }: Props) {
  return (
    <div className="editorial-card border-t-2 border-t-primary/60 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="data-label text-muted-foreground">{title}</p>
        <Icon className="size-4 text-muted-foreground/70" />
      </div>
      <p className="display mt-3 text-4xl tabular-nums text-card-foreground">
        {typeof value === "number" ? <CountUpValue target={value} /> : value}
      </p>
      {description && (
        <p className="mt-2 text-sm text-muted-foreground">
          {description}
          {trend && <span className="ml-1.5 font-semibold text-accent-foreground">{trend}</span>}
        </p>
      )}
    </div>
  )
}
