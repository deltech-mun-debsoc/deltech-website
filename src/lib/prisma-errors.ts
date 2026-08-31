// Postgres/Prisma failures that mean something specific to a human.
//
// Everything else in the recruitment actions funnels into "Something went wrong.
// Reload and try again.", which is the right default for a genuine bug but the
// wrong answer for the one failure that keeps happening: the deployed database
// is behind the code.
//
// It has now bitten twice. The quiz could not present a TRUE_FALSE slide because
// SlideType lacked the value, and recruitment could not add anyone to the society
// because Role lacked MEMBER -- both because a migration had been merged but never
// applied to production, and `build:vercel` deliberately does not migrate. Both
// times the operator saw only "Something went wrong", which points at the code
// rather than at the deploy step that was actually skipped.

export function isUniqueViolation(err: unknown): boolean {
  return code(err) === "P2002"
}

// Postgres 22P02 / Prisma P2007: a value the code knows about that the database's
// enum type does not. In practice this is always an unapplied migration -- the
// generated client and the schema agree, and only the deployed database disagrees.
export function isSchemaDrift(err: unknown): boolean {
  if (code(err) === "P2007") return true
  return /invalid input value for enum|column .* does not exist|relation .* does not exist/i.test(
    message(err),
  )
}

// Says which deploy step was missed, because that is the actionable part.
export const SCHEMA_DRIFT_MESSAGE =
  "The database is missing a schema update this feature needs. An admin must run the pending migrations (npm run db:deploy), then try again."

function code(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("code" in err)) return null
  const c = (err as { code: unknown }).code
  return typeof c === "string" ? c : null
}

function message(err: unknown): string {
  if (err instanceof Error) {
    // Prisma nests the driver's text under meta.driverAdapterError.
    const meta = (err as { meta?: { driverAdapterError?: { message?: string } } }).meta
    return `${err.message} ${meta?.driverAdapterError?.message ?? ""}`
  }
  return typeof err === "string" ? err : ""
}
