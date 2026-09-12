import { IS_PREVIEW } from "@/lib/preview-env"

// "This is not the real site", on every page.
//
// This started as a badge in three area headers, which left the route groups
// with no header of their own -- (public), (author), (registerer) -- showing
// nothing at all. That is the wrong half to miss: (public) holds /signin,
// /signup, /status/[token] and /pay/[token], so the pages where somebody could
// create an account or look at a PAYMENT SCREEN were exactly the pages with no
// indication they were fake.
//
// Rendered once in the root layout instead, so coverage cannot drift as route
// groups are added. Fixed rather than in-flow so it never shifts a layout, and
// pointer-events-none so it can never swallow a click on the UI beneath it.
//
// bg-ink/text-gold-300 are the fixed non-theme-swapping tokens, so this reads
// identically in light and dark.
export function PreviewRibbon() {
  if (!IS_PREVIEW) return null
  return (
    <div
      className="pointer-events-none fixed bottom-3 left-3 z-[100] select-none rounded-full border border-gold-500/60 bg-ink px-3 py-1 font-mono text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-gold-300 shadow-lg"
      role="status"
    >
      Test site &middot; not live
    </div>
  )
}
