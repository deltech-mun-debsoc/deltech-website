// Where a team member's photo lives in the bucket.
//
// Team photos used to be stored as bytes in Postgres (Member.photoBytes), which
// put ~25 MB of images in every database dump, served every view through a
// function and a database read, and grew with the society. They are public
// images; S3 is cheaper, keeps the database small and lets the CDN cache them.
//
// Pure, so scripts/check-media-keys.ts can pin it.

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

export function teamPhotoExtension(mimeType: string): string | null {
  return EXTENSIONS[mimeType.split(";")[0].trim().toLowerCase()] ?? null
}

/**
 * One key per member per upload. The random suffix is what makes a replaced
 * photo appear immediately: the old key stays cached wherever it already is,
 * and nothing has to guess a cache-busting query string.
 */
export function teamPhotoKey(memberId: string, mimeType: string, token: string): string | null {
  const ext = teamPhotoExtension(mimeType)
  if (!ext) return null
  const safeId = memberId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)
  const safeToken = token.replace(/[^A-Za-z0-9]/g, "").slice(0, 12)
  if (!safeId || !safeToken) return null
  return `team/${safeId}-${safeToken}.${ext}`
}
