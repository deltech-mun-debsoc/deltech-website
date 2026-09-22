// Auth.js wraps provider failures in AuthError.cause.err. Keep throttling
// distinguishable from infrastructure failures in the server-action forms.
export class AuthRateLimitError extends Error {
  constructor() {
    super("Too many authentication attempts")
    this.name = "AuthRateLimitError"
  }
}

export function isAuthRateLimitError(error: unknown): boolean {
  let current = error
  for (let depth = 0; depth < 5; depth++) {
    if (current instanceof AuthRateLimitError) return true
    if (!current || typeof current !== "object") return false
    const cause = (current as { cause?: unknown }).cause
    current = cause && typeof cause === "object" && "err" in cause ? cause.err : cause
  }
  return false
}
