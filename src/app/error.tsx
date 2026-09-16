"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

// Did this build get replaced while the page was open?
//
// A tab open across a deploy still holds the previous build's Server Action ids.
// Posting one fails with "Failed to find Server Action", which reaches the user
// as this page even though nothing they did was wrong -- on staging that looked
// exactly like a rejected sign-in. next.config.ts sets a deploymentId so Next
// stamps the build onto <html data-dpl-id>, and /api/health reports the build the
// server is running now. Different means stale, and a reload fixes it.
//
// Reloads at most once per stale build: the id we reloaded for is remembered, and
// after the reload the page carries a new one, so this cannot loop.
// Which build served this page.
//
// Next puts the deployment id on <html data-dpl-id> and on every asset URL as
// ?dpl=. The attribute is in the HTML but does not survive hydration in the
// browser (checked on staging: present over curl, absent in the live DOM), so
// the script tags are the source that actually works, with the attribute kept
// as a cheap first try.
function loadedBuild(): string | null {
  const stamped = document.documentElement.dataset.dplId
  if (stamped) return stamped
  const script = document.querySelector<HTMLScriptElement>('script[src*="dpl="]')
  return script?.src.match(/[?&]dpl=([A-Za-z0-9]+)/)?.[1] ?? null
}

function reloadIfStale(): void {
  const loaded = loadedBuild()
  if (!loaded) return
  let alreadyTried: string | null = null
  try {
    alreadyTried = sessionStorage.getItem("reloadedForBuild")
  } catch {
    return // private mode: skip rather than risk a loop with no memory
  }
  if (alreadyTried === loaded) return

  void fetch("/api/health", { cache: "no-store" })
    .then((r) => r.json())
    .then((body: { version?: string }) => {
      // health reports the first 12 characters of the same commit SHA.
      if (!body.version || loaded.startsWith(body.version)) return
      try {
        sessionStorage.setItem("reloadedForBuild", loaded)
      } catch {
        return
      }
      location.reload()
    })
    .catch(() => {})
}

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[route error]", error)
    reloadIfStale()
  }, [error])

  return (
    <div className="paper-grid grid min-h-svh place-items-center px-4 py-20">
      <div className="editorial-card w-full max-w-md p-8 text-center">
        <p className="eyebrow text-gold-500">Error</p>
        <h1 className="display mt-4 text-4xl">Something went wrong</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          An unexpected error occurred. You can try again, if it keeps happening, the secretariat
          has been notified.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-muted-foreground/70">ref: {error.digest}</p>
        )}
        <div className="rule my-6" />
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  )
}
