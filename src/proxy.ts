import { auth } from "@/lib/auth";

// Next.js 16: proxy.ts replaces middleware.ts and runs on the Node.js runtime, so
// it uses the full auth config, Prisma included, not the edge-only subset.
//
// That is what keeps the gate and the pages agreeing on who you are. The session
// cookie carries the role it was minted with; auth() re-reads the user row once it
// is a minute old. Pages can do that read but cannot write a cookie, so with an
// edge-only proxy the cookie's role never moved: promote a delegate to admin and
// the proxy kept bouncing /admin to /signin while /signin, reading the database,
// bounced them back. Here the refreshed session is written back on the response
// (NextAuth appends its Set-Cookie), so the cookie converges on the database.
// The `authorized` callback in auth.config.ts makes the decision.
export const proxy = auth;

export const config = {
  matcher: [
    "/admin/:path*",
    "/write/:path*",
    "/dashboard/:path*",
    "/account/:path*",
    "/recruitment/:path*",
  ],
};
