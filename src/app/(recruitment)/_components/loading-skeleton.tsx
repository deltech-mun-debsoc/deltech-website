import { Skeleton } from "@/components/ui/skeleton"

// Every recruitment route gets one of these.
//
// None of them had a loading.tsx, so a route that resolves a session, a cycle and
// a membership before it renders anything left the previous screen on the glass
// with no sign it had heard the click. Next streams this instantly and swaps in
// the real page behind it, which is the difference between "slow" and "loading".
//
// One component with a few shapes rather than eight bespoke files: they only ever
// differ in the arrangement of rows, and a skeleton that drifts from its page is
// worse than one that is merely approximate.
type Shape = "list" | "console" | "board" | "detail"

export function RecruitmentLoading({ shape = "list", rows = 6 }: { shape?: Shape; rows?: number }) {
  return (
    <div className="space-y-6">
      {/* Page header: eyebrow, title, description. */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {shape === "list" && (
        <>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-36" />
          </div>
          <div className="space-y-px overflow-hidden rounded-md border border-border/70">
            {Array.from({ length: rows }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-none" />
            ))}
          </div>
        </>
      )}

      {shape === "board" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      )}

      {shape === "console" && (
        <>
          <Skeleton className="h-32 rounded-xl" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-56 rounded-xl" />
            ))}
          </div>
        </>
      )}

      {shape === "detail" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-28 rounded-xl" />
              </div>
            ))}
          </div>
          <div className="space-y-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-40 rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
