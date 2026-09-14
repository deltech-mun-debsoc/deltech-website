import { cleanPortfolioName } from "@/lib/portfolio-sheet"

// Pure helpers for the balance-aware allotment assist. No DB, no React.
// so they stay testable via scripts/check-allot-assist.ts.

export interface PrefDelegate {
  pref1CommitteeId: string | null
  pref2CommitteeId: string | null
  pref3CommitteeId: string | null
}

// A delegate states a preference twice: the id, when they picked a real seat from
// a published matrix, and the name they typed when there was no matrix yet.
export interface SeatPrefDelegate extends PrefDelegate {
  pref1PortfolioId: string | null
  pref1Portfolio: string | null
  pref2PortfolioId: string | null
  pref2Portfolio: string | null
  pref3PortfolioId: string | null
  pref3Portfolio: string | null
}

export interface CommitteeDemand {
  p1: number
  p2: number
  p3: number
}

// How many delegates in the (unallotted) pool name each committee as their
// 1st / 2nd / 3rd preference. This is the signal staff balance against.
// e.g. a committee with 40 pref-1s and 6 seats is over-subscribed, so pushing
// some of those delegates to a thinner 2nd preference is the deliberate call.
export function committeeDemand(delegates: PrefDelegate[]): Map<string, CommitteeDemand> {
  const m = new Map<string, CommitteeDemand>()
  const bump = (id: string | null, key: keyof CommitteeDemand) => {
    if (!id) return
    const d = m.get(id) ?? { p1: 0, p2: 0, p3: 0 }
    d[key] += 1
    m.set(id, d)
  }
  for (const d of delegates) {
    bump(d.pref1CommitteeId, "p1")
    bump(d.pref2CommitteeId, "p2")
    bump(d.pref3CommitteeId, "p3")
  }
  return m
}

// Rank of a committee in a single delegate's preference list (1/2/3) or null.
// pref1 wins if the same committee appears more than once.
export function preferenceRank(d: PrefDelegate, committeeId: string): 1 | 2 | 3 | null {
  if (d.pref1CommitteeId === committeeId) return 1
  if (d.pref2CommitteeId === committeeId) return 2
  if (d.pref3CommitteeId === committeeId) return 3
  return null
}

// Did this delegate ask for THIS seat, and at what rank?
//
// The id wins whenever it is there. It is absent for anyone imported from a
// Google Form, anyone who registered before the matrix was published, and anyone
// whose committee had its matrix republished since, so the typed name is the
// fallback rather than the exception.
//
// Matching is exact on a normalised string, deliberately. cleanPortfolioName is
// reused rather than reimplemented so the two sides are normalised identically,
// and nothing fuzzier is attempted: "Sudan" and "South Sudan" are one edit apart
// and are different chairs. A miss shows the delegate lower down the list, which
// staff can see and search past. A wrong hit seats somebody in the wrong country.
//
// The seat must also be in a committee the delegate actually asked for. Without
// that, "India" in UNSC would light up for someone who wanted "India" in AIPPM.
export function portfolioRank(
  d: SeatPrefDelegate,
  portfolio: { id: string; name: string; committeeId: string },
): 1 | 2 | 3 | null {
  const wanted = normalisePortfolioName(portfolio.name)

  const prefs = [
    { id: d.pref1PortfolioId, name: d.pref1Portfolio, committeeId: d.pref1CommitteeId, rank: 1 as const },
    { id: d.pref2PortfolioId, name: d.pref2Portfolio, committeeId: d.pref2CommitteeId, rank: 2 as const },
    { id: d.pref3PortfolioId, name: d.pref3Portfolio, committeeId: d.pref3CommitteeId, rank: 3 as const },
  ]

  for (const pref of prefs) {
    if (pref.id && pref.id === portfolio.id) return pref.rank
  }
  for (const pref of prefs) {
    if (pref.id) continue
    if (pref.committeeId !== portfolio.committeeId) continue
    if (!pref.name) continue
    if (normalisePortfolioName(pref.name) === wanted) return pref.rank
  }
  return null
}

export const ORDINAL = { 1: "1st", 2: "2nd", 3: "3rd" } as const

// A delegate's choices in order, each resolved to the real seat it names when
// there is one. A choice whose committee is gone is dropped.
export function delegateChoices<
  C extends { id: string; name: string; portfolios: { id: string; name: string; committeeId: string }[] },
>(d: SeatPrefDelegate, committees: C[]): { rank: 1 | 2 | 3; committee: C; seat: C["portfolios"][number] | null; typed: string | null }[] {
  const out: { rank: 1 | 2 | 3; committee: C; seat: C["portfolios"][number] | null; typed: string | null }[] = []
  for (const rank of [1, 2, 3] as const) {
    const committee = committees.find((c) => c.id === d[`pref${rank}CommitteeId`])
    if (!committee) continue
    const seat = committee.portfolios.find((p) => portfolioRank(d, p) === rank) ?? null
    out.push({ rank, committee, seat, typed: d[`pref${rank}Portfolio`] })
  }
  return out
}

function normalisePortfolioName(raw: string): string {
  return cleanPortfolioName(raw).toLowerCase()
}
