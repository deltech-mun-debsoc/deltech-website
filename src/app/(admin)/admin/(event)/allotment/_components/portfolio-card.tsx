"use client"

import { Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SerializedPortfolio, SerializedCommittee } from "./allotment-board"

interface Props {
  portfolio: SerializedPortfolio
  committee: SerializedCommittee
  onClick: () => void
  onRevoke: () => void
}

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available",
  ON_HOLD: "On hold",
  ALLOTTED: "Allotted",
  BLOCKED: "Blocked",
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  AVAILABLE: "default",
  ON_HOLD: "secondary",
  ALLOTTED: "outline",
  BLOCKED: "secondary",
}

export function PortfolioCard({ portfolio, committee, onClick, onRevoke }: Props) {
  const isClickable = portfolio.status === "AVAILABLE" || portfolio.status === "ON_HOLD"
  const isAllotted = portfolio.status === "ALLOTTED"

  return (
    <div
      className={cn(
        "relative rounded-xl border border-border/60 bg-card p-4 shadow-sm transition-all",
        isClickable &&
          "cursor-pointer hover:border-primary/40 hover:shadow-md hover:bg-primary/5",
        isAllotted && "border-primary/20 bg-primary/5",
      )}
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick()
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-card-foreground">{portfolio.name}</p>

          {isAllotted && portfolio.allotment && (
            <div className="mt-1 space-y-0.5">
              <p className="truncate text-xs text-muted-foreground">
                {portfolio.allotment.delegate.fullName}
              </p>
              <p className="truncate text-xs text-muted-foreground opacity-70">
                {portfolio.allotment.delegate.email}
              </p>
              {portfolio.allotment.delegate.isDtu && (
                <span className="inline-block rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                  DTU
                </span>
              )}
              {committee.doubleDelegation && portfolio.allotment.delegate.coDelegate && (
                <p className="truncate text-xs text-muted-foreground">
                  + {portfolio.allotment.delegate.coDelegate.fullName}
                </p>
              )}
            </div>
          )}

          {portfolio.status === "ON_HOLD" && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">In use by another admin</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge variant={STATUS_VARIANT[portfolio.status]}>
            {STATUS_LABEL[portfolio.status]}
          </Badge>
          {isAllotted && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                onRevoke()
              }}
              title="Revoke allotment"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
