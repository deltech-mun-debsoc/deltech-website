// Runnable check for the allotment balance helpers: npx tsx scripts/check-allot-assist.ts
import assert from "node:assert"
import { committeeDemand, preferenceRank, portfolioRank, delegateChoices } from "../src/app/(admin)/admin/(event)/allotment/_lib/balance"

const D = (p1: string | null, p2: string | null = null, p3: string | null = null) => ({
  pref1CommitteeId: p1,
  pref2CommitteeId: p2,
  pref3CommitteeId: p3,
})

// ── committeeDemand ──────────────────────────────────────────────────────────
const demand = committeeDemand([
  D("A", "B", "C"),
  D("A", "C"),
  D("B", "A"),
  D(null, null, null), // no prefs → contributes nothing
])
assert.deepEqual(demand.get("A"), { p1: 2, p2: 1, p3: 0 }) // pref1 x2 (rows 1,2), pref2 x1 (row 3)
assert.deepEqual(demand.get("B"), { p1: 1, p2: 1, p3: 0 }) // pref1 (row 3), pref2 (row 1)
assert.deepEqual(demand.get("C"), { p1: 0, p2: 1, p3: 1 }) // pref2 (row 2), pref3 (row 1)
assert.equal(demand.get("Z"), undefined) // committee nobody wants
assert.equal(demand.size, 3)

// empty pool → empty map
assert.equal(committeeDemand([]).size, 0)

// ── preferenceRank ───────────────────────────────────────────────────────────
assert.equal(preferenceRank(D("A", "B", "C"), "A"), 1)
assert.equal(preferenceRank(D("A", "B", "C"), "B"), 2)
assert.equal(preferenceRank(D("A", "B", "C"), "C"), 3)
assert.equal(preferenceRank(D("A", "B", "C"), "Z"), null)
// same committee listed twice → highest (earliest) rank wins
assert.equal(preferenceRank(D("A", "A"), "A"), 1)
assert.equal(preferenceRank(D(null, null, null), "A"), null)


// ── portfolioRank: who asked for THIS seat ──────────────────────────────────
// The badge this drives is the whole point of the allotment screen, so the ways
// it can be wrong matter more than the way it is right.
{
  const seat = { id: "p_india_unsc", name: "India", committeeId: "unsc" }

  const base = {
    pref1CommitteeId: null, pref2CommitteeId: null, pref3CommitteeId: null,
    pref1PortfolioId: null, pref1Portfolio: null,
    pref2PortfolioId: null, pref2Portfolio: null,
    pref3PortfolioId: null, pref3Portfolio: null,
  }

  // The id wins, and carries its rank.
  assert.equal(portfolioRank({ ...base, pref1PortfolioId: "p_india_unsc" }, seat), 1)
  assert.equal(portfolioRank({ ...base, pref2PortfolioId: "p_india_unsc" }, seat), 2)
  assert.equal(portfolioRank({ ...base, pref3PortfolioId: "p_india_unsc" }, seat), 3)

  // No id, so the typed name is matched, but only inside the committee they asked
  // for. This is the Google Form and the pre-matrix registration case.
  assert.equal(
    portfolioRank({ ...base, pref1CommitteeId: "unsc", pref1Portfolio: "India" }, seat),
    1,
  )

  // Typed casing and stray spacing must not lose a real preference.
  assert.equal(
    portfolioRank({ ...base, pref1CommitteeId: "unsc", pref1Portfolio: "  india  " }, seat),
    1,
    "a delegate typing in lower case still asked for that seat",
  )

  // The same name in a different committee is a different chair.
  assert.equal(
    portfolioRank({ ...base, pref1CommitteeId: "aippm", pref1Portfolio: "India" }, seat),
    null,
    "India in AIPPM must not light up India in UNSC",
  )

  // Near misses are different countries, not typos to be guessed at.
  assert.equal(
    portfolioRank({ ...base, pref1CommitteeId: "unsc", pref1Portfolio: "South Sudan" }, { id: "p", name: "Sudan", committeeId: "unsc" }),
    null,
    "one edit apart is a different seat, so no fuzzy matching",
  )

  // An id that points somewhere else must not fall through to a name that happens
  // to match: the delegate picked a specific seat and it was not this one.
  assert.equal(
    portfolioRank(
      { ...base, pref1CommitteeId: "unsc", pref1PortfolioId: "p_other", pref1Portfolio: "India" },
      seat,
    ),
    null,
    "a chosen seat is authoritative, so a stale name must not override it",
  )

  // Nothing stated at all.
  assert.equal(portfolioRank(base, seat), null)

  // A delegate who asked for this seat second and something else first keeps rank 2.
  assert.equal(
    portfolioRank(
      { ...base, pref1CommitteeId: "unsc", pref1Portfolio: "France", pref2CommitteeId: "unsc", pref2Portfolio: "India" },
      seat,
    ),
    2,
  )

  // ── delegateChoices: what the allotment page lists per delegate ─────────────
  const unsc = { id: "unsc", name: "UNSC", portfolios: [seat, { id: "p_fr", name: "France", committeeId: "unsc" }] }
  const aippm = { id: "aippm", name: "AIPPM", portfolios: [] }
  const choices = delegateChoices(
    { ...base, pref1CommitteeId: "unsc", pref1Portfolio: "india", pref2CommitteeId: "aippm", pref2Portfolio: "PM", pref3CommitteeId: "gone" },
    [unsc, aippm],
  )
  assert.deepEqual(
    choices.map((c) => [c.rank, c.committee.id, c.seat?.id ?? null, c.typed]),
    [[1, "unsc", "p_india_unsc", "india"], [2, "aippm", null, "PM"]],
    "choices resolve to real seats in order, and a removed committee is dropped",
  )
  assert.deepEqual(delegateChoices(base, [unsc]), [])
}

console.log("allot assist checks passed (committee demand, preference rank, seat-level requests)")
