import NextAuth, { type DefaultSession } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";
import { verifyPassword } from "@/lib/password";
import { sessionNeedsRefresh } from "@/lib/user-admin";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { AuthRateLimitError } from "@/lib/auth-errors";
import { MAGIC_LINK_MAX_AGE_S } from "@/lib/magic-link";

// SUB_MAINTAINER is the Junior Council tier: it reaches /recruitment only and
// is structurally locked out of /admin (see roleCanAccess in src/lib/nav.ts).
type AppRole = "ADMIN" | "MAINTAINER" | "MEMBER" | "AUTHOR" | "REGISTERER" | "SUB_MAINTAINER" | "CHAIR";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppRole;
    } & DefaultSession["user"];
  }
}

// JWT extends Record<string, unknown>, so `role` and `checkedAt` are readable
// and writable without a module augmentation ("next-auth/jwt" is not resolvable
// under this tsconfig's module resolution).

// Accounts are only ever created deliberately: /signup for delegates, an admin
// invite for staff. Left to itself the email provider signs *anyone* up: on
// link click Auth.js creates the missing row with the schema default role
// (AUTHOR), which grants /write. So an unknown address must be refused, not
// provisioned. This is also what stops a deleted user walking back in through
// a magic link that was already in their inbox.
// A failed lookup is NOT a refusal, and must never be converted into one here:
// returning false would tell a legitimate user they may not sign in, and Auth.js
// renders that identically whether the callback refused or threw. So the throw
// is deliberately allowed to propagate -- src/app/(public)/signin/actions.ts
// reads AccessDenied's cause to tell the two apart.
//
// The retry covers one dropped pool connection during a burst of first-time logins, is the difference
// between signing in and being told to go away. Anything beyond one retry
// belongs in the pool config, not here.
async function mayStartSession(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const where = { email: email.trim().toLowerCase() };

  let user;
  try {
    user = await prisma.user.findUnique({ where, select: { disabledAt: true } });
  } catch {
    user = await prisma.user.findUnique({ where, select: { disabledAt: true } });
  }

  return !!user && !user.disabledAt;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Resend({
      from: process.env.EMAIL_FROM!,
      maxAge: MAGIC_LINK_MAX_AGE_S,
      // Without this Auth.js sends its own stock template on a raw fetch that
      // never reaches EmailLog. Imported lazily so the email templates stay
      // out of every bundle that merely needs auth().
      async sendVerificationRequest({ identifier, url }) {
        const { sendMagicLink } = await import("@/lib/resend");
        await sendMagicLink(identifier, url);
      },
    }),
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password || email.length > 254 || password.length > 256) return null;
        const limit = await rateLimit(RATE_LIMITS.signIn, email);
        if (!limit.ok) throw new AuthRateLimitError();

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash || !user.emailVerified || user.disabledAt) return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  adapter: PrismaAdapter(prisma),
  callbacks: {
    // Override the callbacks from authConfig, keeping session+authorized
    // and adding jwt/signIn, which need Prisma and so only run on Node.
    ...authConfig.callbacks,

    // Runs before Auth.js creates or resumes anything. For the email provider
    // it fires twice, once when the link is requested and once when it is
    // clicked, so an unknown or disabled address never receives a link and
    // never gets an account created for it.
    async signIn({ user, email, account }) {
      // Enforce at the provider boundary: native /api/auth requests bypass our forms.
      // Only requests consume quota; redeeming a link must remain possible.
      if (email?.verificationRequest && user.email) {
        const limit = await rateLimit(RATE_LIMITS.magicLink, user.email);
        if (!limit.ok) throw new AuthRateLimitError();
      }
      if (!(await mayStartSession(user?.email))) return false;
      if (account?.provider === "resend" && !email?.verificationRequest && user.email) {
        // Discard passwords claimed before mailbox ownership was established.
        await prisma.user.updateMany({
          where: { email: user.email.trim().toLowerCase(), emailVerified: null },
          data: { passwordHash: null },
        });
      }
      return true;
    },

    async jwt({ token, user }) {
      // On sign-in: user is the full object from authorize or the adapter.
      if (user && "role" in user) {
        token.role = (user as { role: AppRole }).role;
        token.checkedAt = Date.now();
        token.verifiedIdentity = true;
        return token;
      }

      // Otherwise re-read the row once the cached copy goes stale, so role
      // changes, disables and deletions take effect on live sessions.
      if (!token.sub) return null;
      if (token.verifiedIdentity === true && !sessionNeedsRefresh(token.checkedAt, Date.now())) return token;

      const dbUser = await prisma.user.findUnique({
        where: { id: token.sub },
        select: { role: true, disabledAt: true, emailVerified: true },
      });
      // Deleted or disabled: returning null invalidates the session.
      if (!dbUser || dbUser.disabledAt || !dbUser.emailVerified) return null;
      token.verifiedIdentity = true;

      token.role = dbUser.role;
      token.checkedAt = Date.now();
      return token;
    },
  },
});

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}
