import { Skeleton } from "@/components/ui/skeleton"

export default function ImportLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <Skeleton className="h-11 w-full rounded-none" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="mx-1 my-0.5 h-12 rounded-lg" />
        ))}
      </div>
    </div>
  )
}
