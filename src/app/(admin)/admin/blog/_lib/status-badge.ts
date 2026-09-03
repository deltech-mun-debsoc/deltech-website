// The blog moderation status palette, shared by the list page, the detail page,
// and the moderation panel -- they used to carry three independent copies of
// this map, two of them byte-identical.
//
// Every entry used to be a light-mode-only Tailwind swatch (`bg-amber-100
// text-amber-700`), which is fine on the app's light default and turns into a
// bright, out-of-place rectangle the instant the admin dashboard is switched to
// dark: those shades are not registered against the theme's CSS variables, so
// they never move with `.dark`. Nearby admin surfaces (checkin, the import
// wizard) already carry `dark:` pairs for the same idiom; this only extends
// that existing convention to blog, which never got it.
export type PostStatus = "PENDING" | "CHANGES_REQUESTED" | "PUBLISHED" | "REJECTED" | "DRAFT"

export const STATUS_BADGE: Record<PostStatus, string> = {
  PENDING:
    "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800",
  CHANGES_REQUESTED:
    "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800",
  PUBLISHED:
    "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950/30 dark:text-teal-300 dark:border-teal-800",
  REJECTED:
    "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800",
  // Already theme tokens, not a raw swatch -- moves with the theme for free.
  DRAFT: "bg-muted text-muted-foreground border-border",
}
