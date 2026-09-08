// "You are not on production." Rendered in every area shell's header.
//
// Deliberately takes no props and reads no environment: the caller decides
// whether to show it, because the marketing header is a client component and
// cannot read VERCEL_ENV itself. Presentational only, so it works in both a
// server and a client tree.
export function PreviewBadge() {
  return (
    <span className="rounded-sm border border-gold-500/50 bg-accent px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-accent-foreground">
      Preview
    </span>
  )
}
