#!/usr/bin/env tsx
// Every human-facing time in this app is IST: npx tsx scripts/check-datetime.ts
//
// Two halves. The formatters are asserted against a known instant while this
// process pretends to be somewhere else entirely, because the bug being pinned is
// precisely "renders correctly on my machine". Then the source tree is swept, so a
// new component cannot quietly reintroduce an unzoned toLocale*Date call.
import assert from "node:assert"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import {
  IST,
  formatDate,
  formatDateLong,
  formatDayMonth,
  formatDateTime,
  formatTime,
  toDateTimeLocalValue,
  fromDateTimeLocalValue,
} from "../src/lib/datetime"

// Run the assertions from somewhere that is emphatically not India. Node reads TZ
// per format call, and datetime.ts does no work at import time, so this takes
// effect below -- the bug being pinned is precisely "renders correctly on my
// machine", and these must fail if a `timeZone` option ever goes missing.
process.env.TZ = "America/Los_Angeles"

assert.equal(IST, "Asia/Kolkata")

// 2026-10-05T21:00:00Z is 2026-10-06 02:30 IST: a different DAY, not just a
// different hour. A formatter that ignored the zone would say "5 Oct" here, so
// this instant catches the whole class of bug rather than an off-by-hours.
const acrossMidnight = new Date("2026-10-05T21:00:00.000Z")
assert.equal(formatDate(acrossMidnight), "6 Oct 2026")
assert.equal(formatDateLong(acrossMidnight), "6 October 2026")
assert.equal(formatDayMonth(acrossMidnight), "6 Oct")
assert.match(formatDateTime(acrossMidnight), /^6 Oct 2026, 02:30 am$/i)
assert.match(formatTime(acrossMidnight), /^02:30 am$/i)

// Mid-afternoon IST, the ordinary case.
const afternoon = new Date("2026-10-05T09:00:00.000Z") // 14:30 IST
assert.equal(formatDate(afternoon), "5 Oct 2026")
assert.match(formatDateTime(afternoon), /^5 Oct 2026, 02:30 pm$/i)

// Accepts what call sites actually hold: Date, ISO string, epoch millis.
assert.equal(formatDate(afternoon.toISOString()), "5 Oct 2026")
assert.equal(formatDate(afternoon.getTime()), "5 Oct 2026")

// --- datetime-local round trip ---------------------------------------------
//
// The scheduling box has no zone of its own; it shows the wall clock it is given.
// toISOString() there wrote UTC into the field, so a 14:30 GD reopened as 09:00.
assert.equal(toDateTimeLocalValue(afternoon), "2026-10-05T14:30")
assert.equal(toDateTimeLocalValue(acrossMidnight), "2026-10-06T02:30")

// ...and typing 14:30 must mean 14:30 IST, not 14:30 wherever the laptop is.
assert.equal(fromDateTimeLocalValue("2026-10-05T14:30").toISOString(), "2026-10-05T09:00:00.000Z")
assert.equal(fromDateTimeLocalValue("2026-10-06T02:30").toISOString(), "2026-10-05T21:00:00.000Z")
// Midnight is the edge the hourCycle "24" fixup exists for.
assert.equal(fromDateTimeLocalValue("2026-10-05T00:00").toISOString(), "2026-10-04T18:30:00.000Z")
assert.equal(toDateTimeLocalValue(new Date("2026-10-04T18:30:00.000Z")), "2026-10-05T00:00")

// Round trip, both directions, at every hour of a day.
for (let h = 0; h < 24; h++) {
  const wall = `2026-10-05T${String(h).padStart(2, "0")}:15`
  assert.equal(toDateTimeLocalValue(fromDateTimeLocalValue(wall)), wall, `round trip broke at ${wall}`)
}

// --- nothing else may format a date ----------------------------------------
//
// The point of a shared formatter is that it is the only one. An ad-hoc
// toLocaleDateString somewhere in a component is exactly how half the app came to
// render UTC in the first place, and it is invisible in review.
function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === "generated") continue
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p)
  }
  return out
}

const offenders: string[] = []
for (const file of walk("src")) {
  if (file === join("src", "lib", "datetime.ts")) continue
  const src = readFileSync(file, "utf8")
  for (const [i, line] of src.split("\n").entries()) {
    // Number formatting shares the toLocaleString name and is not our business:
    // only flag it when it is being called on something date-shaped.
    if (/\.toLocaleDateString\(|\.toLocaleTimeString\(/.test(line)) {
      offenders.push(`${file}:${i + 1}`)
    } else if (/\.toLocaleString\(/.test(line) && /new Date\(|At\)|\bdate\b/i.test(line)) {
      offenders.push(`${file}:${i + 1}`)
    } else if (/toISOString\(\)\.slice\(0,\s*16\)/.test(line)) {
      // The datetime-local shortcut that writes UTC into a scheduling box.
      offenders.push(`${file}:${i + 1}`)
    }
  }
}
assert.deepEqual(
  offenders,
  [],
  `format dates through src/lib/datetime.ts (IST), not ad hoc:\n  ${offenders.join("\n  ")}`,
)

console.log("✅ check-datetime passed (IST pinned, no ad-hoc date formatting)")
