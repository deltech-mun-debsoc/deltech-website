"use client"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The one tab strip the recruitment screens share.
//
// The candidate list grew an All/Final toggle first; Live/Past on the panels and
// Waiting/Past on the interview queue are the same control, so they are the same
// component rather than three sets of near-identical buttons drifting apart.
//
// Purely presentational: every caller already holds both lists in the browser, so
// switching tabs never touches the server.
export function TabStrip<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T
  onChange: (next: T) => void
  tabs: { value: T; label: string; count?: number }[]
}) {
  return (
    <div className="flex gap-2 border-b border-border/70 pb-3" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={cn(
            buttonVariants({ variant: value === tab.value ? "default" : "ghost", size: "sm" }),
          )}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined && ` · ${tab.count}`}
        </button>
      ))}
    </div>
  )
}
