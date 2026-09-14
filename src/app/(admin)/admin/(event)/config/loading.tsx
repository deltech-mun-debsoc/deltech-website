import { Skeleton } from "@/components/ui/skeleton"

export default function ConfigLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-36" />
        <Skeleton className="mt-1.5 h-4 w-64" />
      </div>

      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-lg" />
        ))}
      </div>

      <Skeleton className="h-[480px] rounded-xl" />
    </div>
  )
}
