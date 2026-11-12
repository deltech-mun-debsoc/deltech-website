// What an email's status becomes when a provider event arrives for it. SNS
// delivers at least once and out of order, so an event may only move a status
// forward: a late "delivered" never hides a bounce, and a complaint (which can
// follow a delivery) always wins.
const RANK: Record<string, number> = { FAILED: 0, SENT: 1, DEFERRED: 2, DELIVERED: 3, BOUNCED: 4, COMPLAINED: 5 }

export function nextEmailStatus(current: string, incoming: "DELIVERED" | "DEFERRED" | "BOUNCED" | "COMPLAINED"): string {
  // A send that failed at the provider never went anywhere; nothing follows it.
  if (current === "FAILED") return current
  return (RANK[incoming] ?? 0) > (RANK[current] ?? 0) ? incoming : current
}
