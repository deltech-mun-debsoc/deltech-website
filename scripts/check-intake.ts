// Smallest runnable check for the intake normalizers: npx tsx scripts/check-intake.ts
import assert from "node:assert"
import { normalizeEmail, normalizePhone, normalizeName, matchCommittee, resolveCommittee, aliasCollision } from "../src/lib/intake"

assert.equal(normalizeEmail(" Ritu.Sharma@GMIAL.com "), "ritu.sharma@gmail.com")
assert.equal(normalizeEmail("a b@yahooo.co.in"), "ab@yahoo.co.in")

assert.equal(normalizePhone("+91-98765 43210"), "919876543210")
assert.equal(normalizePhone("09876543210"), "919876543210")
assert.equal(normalizePhone("9876543210"), "919876543210")
assert.equal(normalizePhone("919876543210"), "919876543210")
assert.equal(normalizePhone("same as above"), undefined)
assert.equal(normalizePhone("N/A"), undefined)
assert.equal(normalizePhone("12345"), undefined)

assert.equal(normalizeName("  RITU   SHARMA "), "Ritu Sharma")
assert.equal(normalizeName("Dr. anita verma"), "Anita Verma")
assert.equal(normalizeName("md. arshad"), "Md. Arshad")

const committees = [
  { id: "1", name: "UNGA-DISEC", slug: "unga-disec", aliases: ["DISEC", "GA1"] },
  { id: "2", name: "Lok Sabha", slug: "lok-sabha", aliases: [] },
]
assert.equal(matchCommittee("unga-disec", committees)?.id, "1")
assert.equal(matchCommittee("disec", committees)?.id, "1")
assert.equal(matchCommittee("GA1 ", committees)?.id, "1")
assert.equal(matchCommittee("LOK SABHA", committees)?.id, "2")
assert.equal(matchCommittee("UNSC", committees), undefined)

// Punctuation and spacing do not make a different committee.
assert.equal(matchCommittee("UNGA DISEC", committees)?.id, "1")

// Two committees sharing an alias: nothing is picked. The first one in query
// order used to win silently.
const shared = [
  { id: "a", name: "UNGA-DISEC", slug: "unga-disec", aliases: ["DISEC"] },
  { id: "b", name: "DISEC Junior", slug: "disec-jr", aliases: ["DISEC"] },
]
const amb = resolveCommittee("disec", shared)
assert.equal(amb.kind, "ambiguous")
assert.deepEqual(amb.kind === "ambiguous" && amb.candidates.map((c) => c.id), ["a", "b"])
assert.equal(matchCommittee("disec", shared), undefined, "an ambiguous answer must not resolve")
// A committee's own name outranks another committee's alias.
assert.equal(matchCommittee("UNGA-DISEC", shared)?.id, "a")

// A near spelling is a suggestion for a person, never a match.
const near = resolveCommittee("UNGA DISECC", committees)
assert.equal(near.kind, "none")
assert.deepEqual(near.kind === "none" && near.suggestions.map((c) => c.id), ["1"])
assert.equal(matchCommittee("UNGA DISECC", committees), undefined)
const far = resolveCommittee("Security Council", committees)
assert.deepEqual(far.kind === "none" && far.suggestions, [], "an unrelated answer has no suggestion")

// Setup refuses an alias another committee already answers to.
assert.match(aliasCollision({ id: "2", name: "Lok Sabha", aliases: ["disec"] }, committees) ?? "", /already names UNGA-DISEC/)
assert.equal(aliasCollision({ id: "1", name: "UNGA-DISEC", slug: "unga-disec", aliases: ["DISEC", "GA 1"] }, committees), null, "a committee's own aliases do not collide with itself")
assert.match(aliasCollision({ name: "New", aliases: ["Lok-Sabha"] }, committees) ?? "", /already names Lok Sabha/)

console.log("intake normalizer checks passed (incl. ambiguous aliases and near spellings)")
