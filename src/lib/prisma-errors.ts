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
  // P2007 validation, P2021 missing table, P2022 missing column. Prisma words
  // P2021 as "The table `X` does not exist", which the driver-level "relation ...
  // does not exist" pattern below does NOT match -- so a table left behind by an
  // unapplied migration used to fall through to the generic message, which is the
  // exact outcome this module exists to prevent.
  const c = code(err)
  if (c === "P2007" || c === "P2021" || c === "P2022") return true
  return /invalid input value for enum|column .* does not exist|relation .* does not exist|table .* does not exist/i.test(
    message(err),
  )
}

// A short, safe handle on one failure.
//
// Everything that is not a known-and-named failure ends at "Something went wrong",
// and nothing tied the string an operator reads off the screen to the stack trace
// in the runtime log. Diagnosing one then meant guessing. Now the operator quotes
// six characters and it greps straight to the exception.
//
// Carries no data: a random handle, plus the Prisma error code when there is one,
// which is an identifier like "P2028", never a message or a value.
export interface FailureRef {
  ref: string
  code: string | null
}

export function failureRef(err: unknown): FailureRef {
  return {
    ref: Math.random().toString(36).slice(2, 8),
    code: code(err),
  }
}

// The one place the generic message is written, so all six action files agree.
export function unexpectedFailureMessage(ref: FailureRef): string {
  return `Something went wrong (ref ${ref.ref}${ref.code ? ` · ${ref.code}` : ""}). Reload and try again, and quote that reference if it keeps happening.`
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
