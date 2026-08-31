// Every date and time this app shows a human is in IST. The conference runs in
// Delhi; a delegate reading "GD at 09:00" has to be able to walk into the room.
//
// Pinning the zone explicitly matters more than it looks. These same components
// render twice: once on the server, where Vercel's clock is UTC, and again in the
// browser, where the clock is wherever the viewer is. A format call that omits
// `timeZone` therefore produced two different strings for the same instant, which
// is a hydration mismatch as well as a wrong time. Setting TZ=Asia/Kolkata on the
// server would fix only half of that, and would still show a travelling organiser
// their own local time. So the zone is named here, on both halves, and nothing
// else in the app is allowed to format a date -- see scripts/check-datetime.ts.

export const IST = "Asia/Kolkata"
const LOCALE = "en-IN"

type When = Date | string | number

// Callers hold ISO strings from the database, real Dates, and epoch millis.
// Normalising here keeps the call sites free of `new Date(...)` noise.
function toDate(when: When): Date {
  return when instanceof Date ? when : new Date(when)
}

/** "5 Sep 2026" -- the default for anything dated but not timed. */
export function formatDate(when: When): string {
  return toDate(when).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: IST,
  })
}

/** "5 September 2026" -- for prose: blog bylines, email bodies. */
export function formatDateLong(when: When): string {
  return toDate(when).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: IST,
  })
}

/** "5 Sep" -- for tight rows where the year is already obvious from context. */
export function formatDayMonth(when: When): string {
  return toDate(when).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
    timeZone: IST,
  })
}

/** "5 Sep 2026, 2:30 pm" -- audit rows, check-ins, anything where the hour matters. */
export function formatDateTime(when: When): string {
  return toDate(when).toLocaleString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: IST,
  })
}

/** "2:30 pm" -- when the day is already stated next to it. */
export function formatTime(when: When): string {
  return toDate(when).toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: IST,
  })
}

/**
 * "2026-09-05T14:30" in IST, for the value of an <input type="datetime-local">.
 *
 * toISOString() would put UTC in that box, so a GD scheduled for 14:30 IST opened
 * for editing as 09:00 and saved back five and a half hours early. The input has
 * no timezone of its own -- it shows exactly the wall clock it is given.
 */
export function toDateTimeLocalValue(when: When): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: IST,
  }).formatToParts(toDate(when))
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  // en-CA gives ISO-ordered parts, but hourCycle can render midnight as "24".
  const hour = get("hour") === "24" ? "00" : get("hour")
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`
}

/**
 * The instant meant by a wall-clock string from an <input type="datetime-local">.
 *
 * `new Date("2026-09-05T14:30")` parses in the *browser's* zone, so an organiser
 * scheduling from a laptop set to UTC created a GD five and a half hours off. The
 * offset is derived rather than hardcoded to +05:30 so this stays correct if the
 * zone is ever changed, and because India has no daylight saving to complicate it.
 */
export function fromDateTimeLocalValue(value: string): Date {
  // Interpret the wall clock as if it were UTC, then subtract IST's offset from
  // UTC at that moment to recover the real instant.
  const asUtc = new Date(`${value}:00.000Z`)
  if (Number.isNaN(asUtc.getTime())) return new Date(NaN)
  const offsetMs = asUtc.getTime() - new Date(toDateTimeLocalValue(asUtc) + ":00.000Z").getTime()
  return new Date(asUtc.getTime() + offsetMs)
}
