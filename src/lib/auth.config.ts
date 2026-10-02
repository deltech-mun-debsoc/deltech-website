import type { NextAuthConfig } from "next-auth";
import { roleCanAccess, roleHome } from "@/lib/nav";

// The provider-free half of the auth config: pages, session strategy and the
// session/authorized callbacks. auth.ts spreads it and adds providers and the
// jwt callback, which needs Prisma. Kept free of Prisma so nav-level code can
// import it without pulling in the database client.
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
    // One rule, shared with safeLanding: roleCanAccess in src/lib/nav.ts.
    //
    // A signed-in visitor who may not be here goes to their own home, never to
    // /signin. The sign-in page sends a signed-in visitor straight back on, so
    // routing them through it made every disagreement about their role a
    // redirect loop. roleHome(role) always passes roleCanAccess for that role
    // (pinned in scripts/check-nav.ts), so this redirect cannot bounce again.
    authorized({ auth, request }) {
      const role = (auth?.user as { role?: string } | undefined)?.role;
      if (roleCanAccess(request.nextUrl.pathname, role)) return true;
      if (role) return Response.redirect(new URL(roleHome(role), request.nextUrl));
      return false; // signed out: /signin?callbackUrl=...
    },
  },
} satisfies NextAuthConfig;
