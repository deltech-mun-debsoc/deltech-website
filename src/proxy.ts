import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Next.js 16: proxy.ts replaces middleware.ts. Named export `proxy` (or default).
// Uses auth.config.ts (no Prisma import) so this runs safely on the Edge runtime.
// The `authorized` callback in authConfig handles /admin/*, /write/*, /recruitment/*
// and /dashboard/* protection.
const { auth } = NextAuth(authConfig);

export const proxy = auth;

export const config = {
  matcher: [
    "/admin/:path*",
    "/write/:path*",
    "/dashboard/:path*",
    "/account/:path*",
    "/recruitment/:path*",
    "/chair/:path*",
  ],
};
