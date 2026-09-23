import type { NextAuthConfig } from "next-auth";
import { roleHome } from "@/lib/nav";

// Edge-safe config: no providers, no Prisma. Imported by both auth.ts and proxy.ts.
// Providers and the JWT callback (which needs Prisma) live in auth.ts only.
export const authConfig = {
  providers: [],
  pages: {
    signIn: "/signin",
    verifyRequest: "/signin/sent",
    error: "/signin",
  },
  session: { strategy: "jwt" },
  callbacks: {
    // Reads role from the already-decoded JWT and puts it on session.user.
    // Works in both the proxy and the full server config.
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((token as any).role) (session.user as any).role = (token as any).role;
      }
      return session;
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const role = (auth?.user as { role?: string } | undefined)?.role;

      if (pathname.startsWith("/admin")) {
        return role === "ADMIN" || role === "MAINTAINER";
      }

      if (pathname.startsWith("/write")) {
        return role === "AUTHOR" || role === "ADMIN" || role === "MAINTAINER";
      }

      // Any signed-in role may manage their own account.
      if (pathname.startsWith("/account")) return !!role

      // Coarse gate only: any authenticated role may hold a per-cycle recruitment
      // assignment, and the edge cannot query RecruitmentMember. The authoritative
      // check is requireRecruitmentAccess() in the (recruitment) layout.
      if (pathname.startsWith("/recruitment")) {
        return !!role;
      }

      // Which committee a chair runs is the (chair) layout's call; the edge only
      // keeps every other role out.
      if (pathname.startsWith("/chair")) {
        if (role === "CHAIR") return true;
        if (role) return Response.redirect(new URL(roleHome(role), request.nextUrl));
        return false;
      }

      if (pathname.startsWith("/dashboard")) {
        if (role === "REGISTERER") return true;
        // Any other authenticated role (staff, author) belongs elsewhere.
        // send them to their own home instead of a dead-end bounce to /signin.
        if (role) return Response.redirect(new URL(roleHome(role), request.nextUrl));
        return false; // unauthenticated → /signin
      }

      return true;
    },
  },
} satisfies NextAuthConfig;
