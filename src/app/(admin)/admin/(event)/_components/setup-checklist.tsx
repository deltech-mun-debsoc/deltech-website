import Link from "next/link"
import { Check, Circle, ArrowRight } from "lucide-react"

export interface ChecklistItem {
  done: boolean
  label: string
  href: string
}

export function SetupChecklist({ items }: { items: ChecklistItem[] }) {
  const allDone = items.every((item) => item.done)
  if (allDone) return null

  const doneCount = items.filter((item) => item.done).length
  const progress = Math.round((doneCount / items.length) * 100)

  return (
    <section className="border border-border/80 bg-card p-6 sm:p-8">
      <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <p className="data-label text-gold-700">Operating readiness</p>
          <h2 className="mt-3 font-heading text-3xl">Finish the operating setup</h2>
          <p className="mt-2 text-base text-muted-foreground">{doneCount} of {items.length} checks complete. The list adapts to society, flagship, and free Intra modes.</p>
        </div>
        <p className="font-mono text-4xl font-semibold tabular-nums text-primary">{progress}%</p>
      </div>

      <div className="mt-6 h-1.5 overflow-hidden bg-muted" aria-hidden>
        <div className="h-full bg-primary transition-[width]" style={{ width: progress + "%" }} />
      </div>

      <ol className="mt-7 border-t border-border/70">
        {items.map((item, index) => (
          <li key={item.label}>
            <Link href={item.href} className="group grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-border/70 py-4 text-base transition-colors hover:text-primary">
              {item.done ? <Check className="size-5 text-primary" /> : <Circle className="size-5 text-muted-foreground/45" />}
              <span className={item.done ? "text-muted-foreground line-through" : "font-medium"}>
                {String(index + 1).padStart(2, "0")} · {item.label}
              </span>
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
