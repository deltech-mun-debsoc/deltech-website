// Role-aware post-auth landing. Pure string logic, no Prisma, no React.
// safe to import from the edge (auth.config.ts / proxy) and from route handlers.

export type Role = "ADMIN" | "MAINTAINER" | "MEMBER" | "AUTHOR" | "REGISTERER" | "SUB_MAINTAINER"

// The home surface for each role. Single source of truth, reused by the /go
// dispatch route, the sign-in actions, and the route-group layouts/guards.
export function roleHome(role: string | null | undefined): string {
  switch (role) {
    case "ADMIN":
    case "MAINTAINER":
      return "/admin"
    case "AUTHOR":
      return "/write"
    case "MEMBER":
      return "/account"
    case "REGISTERER":
      return "/dashboard"
    // Junior Council: recruitment is the only surface this account has.
    case "SUB_MAINTAINER":
      return "/recruitment"
    default:
      return "/"
  }
}

// Can this role reach this path? Mirrors the gates in auth.config.ts `authorized`
// so we never hand someone a landing they'd immediately bounce off (loop guard).
function roleCanAccess(pathname: string, role: string | null | undefined): boolean {
  if (pathname.startsWith("/admin")) return role === "ADMIN" || role === "MAINTAINER"
  if (pathname.startsWith("/write")) return role === "AUTHOR" || role === "ADMIN" || role === "MAINTAINER"
  if (pathname.startsWith("/dashboard")) return role === "REGISTERER"
  if (pathname.startsWith("/account")) return !!role // any signed-in role
  // /recruitment is coarse-gated here (any signed-in role may be assigned to a
  // cycle regardless of app role) and authoritatively gated by the route-group
  // layout, which checks RecruitmentMember against the database. The edge cannot
  // reach Prisma, so this is the widest correct answer rather than a guess.
  if (pathname.startsWith("/recruitment")) return !!role
  return true // public path
}

// Resolve a post-auth destination from an untrusted callbackUrl.
//
// Two shapes are honored: a path-absolute reference ("/admin?x=1"), and an
// absolute URL whose origin matches this app's · NextAuth's `authorized`
// bounce emits the latter (?callbackUrl=https://host/admin), so rejecting it
// outright would silently downgrade every intended destination to role home.
// Anything else (foreign origin, protocol-relative //host, backslash tricks,
// non-http schemes) falls back to the role home.
//
// If the destination is same-origin but this role can't reach it, downgrade to
// role home rather than send them somewhere they'd immediately bounce off.
export function safeLanding(
  raw: string | null | undefined,
  role: string | null | undefined,
  origin?: string | null,
): string {
  const home = roleHome(role)
  if (!raw) return home

  let candidate = raw

  // Absolute URL, honor it only when the origin matches ours.
  if (/^https?:\/\//i.test(raw)) {
    if (!origin) return home
    try {
      const target = new URL(raw)
      if (target.origin !== new URL(origin).origin) return home
      candidate = target.pathname + target.search + target.hash
    } catch {
      return home
    }
  }

  // Path-absolute only: one leading slash, not protocol-relative, no backslash
  // tricks. Any remaining scheme (javascript:, //host) fails these checks.
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return home
  }

  const pathname = candidate.split(/[?#]/)[0]
  return roleCanAccess(pathname, role) ? candidate : home
}
