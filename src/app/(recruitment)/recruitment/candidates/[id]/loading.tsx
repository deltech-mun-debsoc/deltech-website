import { Skeleton } from "@/components/ui/skeleton"

// The dossier is a dynamic route behind two auth resolutions and a nested query,
// so a cold open used to sit on the previous screen with nothing happening. There
// was no loading.tsx anywhere under (recruitment), which also meant the `prefetch`
// on every "Open dossier" link had no shell to land on.
//
// Mirrors the real page's `grid lg:grid-cols-[1fr_20rem]` so the content does not
// jump when it arrives.
export default function CandidateDossierLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-72" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, section) => (
            <section key={section} className="space-y-3">
              <Skeleton className="h-4 w-32" />
              <div className="space-y-2 rounded-xl border border-border/60 bg-card p-4">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            </section>
          ))}
        </div>

        <div className="space-y-6">
          {Array.from({ length: 2 }).map((_, panel) => (
            <section key={panel} className="space-y-3">
              <Skeleton className="h-4 w-24" />
              <div className="space-y-2 rounded-xl border border-border/60 bg-card p-4">
                {Array.from({ length: 4 }).map((_, row) => (
                  <Skeleton key={row} className="h-4 w-full" />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
