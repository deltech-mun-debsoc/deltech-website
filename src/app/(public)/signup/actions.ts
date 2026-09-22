"use server";

import { signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthError } from "next-auth";
import { isAuthRateLimitError } from "@/lib/auth-errors";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

export async function signupWithMagicLink(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  if (!email) return { error: "errorDefault" };

  const limit = await rateLimit(RATE_LIMITS.signup, email);
  if (!limit.ok) return { error: "tooManyRequests" };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== "REGISTERER") return { error: "nonDelegateAccount" };
    // Already a registerer, so just resend the link so they can sign in.
  } else {
    try {
      await prisma.user.create({ data: { email, role: "REGISTERER" } });
    } catch (err) {
      // Lost a race with a concurrent signup for the same address. The row we
      // wanted now exists, which is all this step needed, so carry on.
      if (!isUniqueViolation(err)) throw err;
    }
  }

  try {
    // /go dispatches by role, a new REGISTERER lands on /dashboard.
    await signIn("resend", { email, redirectTo: "/go" });
    return {};
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw err;
    if (isAuthRateLimitError(err)) return { error: "tooManyRequests" };
    if (err instanceof AuthError) return { error: "errorDefault" };
    return { error: "errorDefault" };
  }
}
