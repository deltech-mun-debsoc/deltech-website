// Runnable check: npx tsx scripts/check-experience.ts
import assert from "node:assert"
import { experienceScore } from "../src/app/(admin)/admin/(event)/allotment/_lib/experience"

for (const none of [null, "", "  ", "None", "no", "N/A", "nil", "-", "0", "First MUN", "first time"]) {
  assert.equal(experienceScore(none), 0, `${JSON.stringify(none)} is a first-timer`)
}
assert.equal(experienceScore("Two previous conferences"), 2)
assert.equal(experienceScore("3 MUNs"), 3)
assert.equal(experienceScore("HRC at DTU MUN 2025, Lok Sabha at NSUT, UNSC at IIT"), 3)
assert.equal(experienceScore("DISEC\nAIPPM"), 2)
assert.equal(experienceScore("Attended one MUN"), 1)
assert.ok(experienceScore("UNSC, HRC, DISEC, AIPPM") > experienceScore("One MUN"), "more listed beats fewer")

console.log("experience checks passed (first-timers, stated counts, listed entries)")
