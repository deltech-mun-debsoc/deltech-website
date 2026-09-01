"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";

// Everything lands on /go, the role-aware dispatch route. It resolves the final
// destination from the intended callbackUrl (sanitized) + the user's role.
// so magic-link users don't get stranded on the marketing home.
function dispatchTarget(formData: FormData): string {
  const callbackUrl = (formData.get("callbackUrl") as string | null)?.trim();
  return callbackUrl ? `/go?to=${encodeURIComponent(callbackUrl)}` : "/go";
}

// Did this AccessDenied come from our signIn callback *throwing*, rather than
// from it returning false?
//
// Auth.js does not distinguish them:
//
//     try { authorized = await callbacks.signIn(...) }
//     catch (e) { throw new AccessDenied(e) }
//     if (!authorized) throw new AccessDenied("AccessDenied")
//
// mayStartSession reads the user row from Postgres, so a pooler hiccup, a cold
// start or a dropped Supabase connection all arrived here as "this person may
// not sign in" and were reported to a real user, with a correct address, as
// "Something went wrong. Please try again." That is what made a working sign-in
// look broken during the Junior Council onboarding wave: many simultaneous
// first-time logins is exactly when the connection pool is under most strain.
//
// The two cases are distinguishable and nothing used to look. `new
// AccessDenied(e)` sets cause.err to the original error; the `!authorized` path
// throws a string and has no cause. See the AuthError constructor in
// @auth/core/errors.js.
function underlyingError(err: unknown): Error | null {
  if (!(err instanceof AuthError)) return null;
  const cause = err.cause as { err?: unknown } | undefined;
  return cause?.err instanceof Error ? cause.err : null;
}

export async function requestMagicLink(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  // Lowercased like every other auth path. Without this, a link requested for
  // "Foo@Bar.com" mints a VerificationToken whose identifier never matches the
  // stored (lowercased) User.email, so the link resolves to nothing.
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  if (!email) return { error: "errorDefault" };

  // Otherwise anyone can mail-bomb an address and burn the Resend quota.
  const limit = await rateLimit(RATE_LIMITS.magicLink, email);
  if (!limit.ok) return { error: "tooManyRequests" };

  try {
    await signIn("resend", { email, redirectTo: dispatchTarget(formData) });
    return {};
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw err;

    const underlying = underlyingError(err);
    if (underlying) {
      // Logged because this path wrote no trace anywhere: it fails before the
      // send, so there is no EmailLog row either, and the audit that went
      // looking for it could only reason about it from the Auth.js source.
      console.error("[signin] magic link failed for an infrastructure reason:", underlying);
      return { error: "errorRetry" };
    }

    // A real refusal: no account for this address, or the account is disabled.
    // Land on the same "check your inbox" page a successful send does, rather
    // than reporting a fault for what is usually a typo. "Something went wrong"
    // reads as our failure, so people retried the same wrong address instead of
    // correcting it.
    //
    // Identical to the success path on purpose: naming the reason would confirm
    // which addresses are registered, which is the same reason
    // noPasswordYetHint is worded the way it is. /signin/sent says outright
    // that nothing arrives if the address has no account.
    if (err instanceof AuthError) redirect("/signin/sent");
    return { error: "errorDefault" };
  }
}

export async function signInWithPassword(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const password = formData.get("password") as string;
  if (!email) return { error: "invalidCredentials" };

  // Credential stuffing against an 8-character-minimum password with no
  // lockout. Keyed on the email, so one account under attack cannot lock
  // anyone else out.
  const limit = await rateLimit(RATE_LIMITS.signIn, email);
  if (!limit.ok) return { error: "tooManyRequests" };

  try {
    await signIn("credentials", { email, password, redirectTo: dispatchTarget(formData) });
    return {};
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw err;

    // Same blindness as the magic link had: authorize() reads the user row, so a
    // database fault was reported as "Invalid email or password" -- telling
    // someone their correct password is wrong.
    const underlying = underlyingError(err);
    if (underlying) {
      console.error("[signin] password sign-in failed for an infrastructure reason:", underlying);
      return { error: "errorRetry" };
    }

    if (err instanceof AuthError) return { error: "invalidCredentials" };
    return { error: "errorDefault" };
  }
}
