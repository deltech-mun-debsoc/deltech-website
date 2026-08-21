#!/usr/bin/env tsx
// Security controls fail silently when they regress: the feature keeps
// working, it just stops being safe. These pin the ones added here, plus the
// properties that were already correct and must not be undone.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { RATE_LIMITS } from "../src/lib/rate-limit"

const read = (p: string) => readFileSync(p, "utf8")

// --- quiz scoring uses the server's clock ---------------------------------
//
// `submittedAt` came from the request body and fed the speed bonus directly,
// so POSTing 0 scored the full 1000 on every correct answer.
{
  const route = read("src/app/api/quiz/responses/route.ts")
  assert.doesNotMatch(
    route,
    /const \{[^}]*submittedAt[^}]*\} = body/,
    "the client clock must not be read out of the request body",
  )
  assert.doesNotMatch(route, /submittedAt \/ 1000/, "scoring must not use a client-supplied elapsed time")
  assert.match(route, /session\.currentSlideStartedAt/, "elapsed time must come from the server record")
  assert.match(
    route,
    /session\.currentSlideId !== slideId/,
    "answers must only be accepted for the slide that is actually live",
  )

  const participant = read("src/app/(public)/quiz/[code]/_components/participant-app.tsx")
  assert.doesNotMatch(participant, /submittedAt:/, "the client must stop sending its own timing")

  // The server can only know when a slide went live if the presenter says so.
  const presentActions = read("src/app/(admin)/admin/quiz/[id]/present/actions.ts")
  assert.match(presentActions, /export async function startSlide/, "startSlide must exist")
  assert.match(presentActions, /currentSlideStartedAt: new Date\(\)/, "and must stamp the start time")
  const presenter = read("src/app/(admin)/admin/quiz/[id]/present/_components/presenter-app.tsx")
  assert.match(presenter, /startSlide\(session\.id, slide\.id\)/, "the presenter must call it on GOTO")
}

// --- rate limits exist and are sane ---------------------------------------
{
  for (const [name, rule] of Object.entries(RATE_LIMITS)) {
    assert.ok(rule.limit > 0, `${name} limit must be positive`)
    assert.ok(rule.windowMs > 0, `${name} window must be positive`)
    // A limit this loose is not a limit.
    assert.ok(rule.limit <= 100, `${name} limit of ${rule.limit} is too loose to matter`)
  }
  // Credential stuffing is the tightest case.
  assert.ok(RATE_LIMITS.signIn.limit <= 15, "sign-in must be tightly limited")
  assert.ok(RATE_LIMITS.magicLink.limit <= 10, "magic-link sending must be tightly limited")

  const applied: [string, string][] = [
    ["src/app/(public)/signin/actions.ts", "RATE_LIMITS.signIn"],
    ["src/app/(public)/signin/actions.ts", "RATE_LIMITS.magicLink"],
    ["src/app/(public)/signup/actions.ts", "RATE_LIMITS.signup"],
    ["src/app/(marketing)/register/actions.ts", "RATE_LIMITS.register"],
    ["src/app/api/quiz/sessions/route.ts", "RATE_LIMITS.quizLookup"],
    ["src/app/api/quiz/responses/route.ts", "RATE_LIMITS.quizAnswer"],
  ]
  for (const [file, rule] of applied) {
    assert.match(read(file), new RegExp(rule.replace(".", "\\.")), `${file} must apply ${rule}`)
  }

  // A limiter that takes sign-in down with it is worse than none.
  const lib = read("src/lib/rate-limit.ts")
  assert.match(lib, /} catch \{\s*return \{ ok: true, retryAfter: 0 \}/, "the limiter must fail open")
}

// --- uploads are allowlisted ----------------------------------------------
//
// An SVG or HTML file accepted here would be stored XSS on whatever origin
// serves the bucket, and an extension taken from the filename gave traversal
// ("x.jpg/../../evil"). Uploads now go through the S3 pipeline, so the
// invariant lives in src/lib/media/keys.ts: the extension is derived from a
// validated MIME type and the object key is built from ids, never from the
// filename. scripts/check-media-keys.ts exercises the behaviour; this pins the
// shape so it cannot be quietly loosened.
{
  const keys = read("src/lib/media/keys.ts")
  assert.match(keys, /MEDIA_POLICY/, "uploads need a per-kind policy")
  assert.match(keys, /maxBytes/, "uploads need a size cap")
  assert.match(keys, /mimeTypes/, "uploads need a MIME allowlist")

  // The allowlist is the map of permitted MIME types. Anything scriptable must
  // be absent from it entirely.
  const table = keys.slice(keys.indexOf("const IMAGE_TYPES"), keys.indexOf("export interface KindPolicy"))
  for (const bad of ["svg", "html", "javascript", "xml"]) {
    assert.doesNotMatch(table, new RegExp(bad, "i"), `${bad} must not be uploadable`)
  }

  // The key is assembled from a validated extension plus sanitised ids.
  assert.match(keys, /function buildObjectKey/, "object keys must be constructed, not interpolated")
  assert.match(keys, /function safeSegment/, "key segments must be sanitised")

  // The server must never trust the client's declared type or size: the object
  // is re-checked with HeadObject before it is marked usable.
  const actions = read("src/lib/media/actions.ts")
  assert.match(actions, /headObject/, "the finalize step must verify the real object")
  assert.match(
    actions,
    /validateUpload\(asset\.kind, realType/,
    "finalize must re-validate against the object's actual content type",
  )

  // Candidate documents are personal data. A cycle role alone must not reach
  // them: the JC group scoping used by every other candidate surface applies
  // here too, or a JC could read the whole cycle's uploads.
  assert.match(
    actions,
    /visibleGroupIds\(ctx\)/,
    "CANDIDATE_DOC access must be scoped to the caller's visible groups",
  )

  // And the old Supabase upload paths must stay gone, or they would reintroduce
  // an unverified public-bucket write alongside the hardened one.
  for (const f of ["src/app/(author)/write/[id]/actions.ts", "src/app/(admin)/admin/team/actions.ts"]) {
    assert.doesNotMatch(read(f), /supabase\.storage/, `${f} must not upload to Supabase Storage directly`)
  }
}

// --- link rendering is an allowlist ---------------------------------------
{
  const src = read("src/lib/tiptap-renderer.tsx")
  assert.match(src, /SAFE_SCHEMES/, "safeHref must allowlist schemes")
  assert.doesNotMatch(
    src,
    /startsWith\("javascript:"\)/,
    "a denylist loses to encoding tricks; allowlist instead",
  )
}

// --- security headers are set ---------------------------------------------
{
  const src = read("next.config.ts")
  for (const header of [
    "X-Content-Type-Options",
    "Referrer-Policy",
    "X-Frame-Options",
    "Permissions-Policy",
  ]) {
    assert.match(src, new RegExp(header), `${header} must be set`)
  }
  // Deliberately report-only until the reports have been read. If someone
  // flips it to enforcing, that must be a conscious edit to this assertion.
  assert.match(src, /Content-Security-Policy-Report-Only/, "CSP ships report-only first")
  assert.match(src, /frame-ancestors 'none'/, "the admin console must not be framable")
}

// --- things that were already right and must stay that way ----------------
{
  // Delegate PII export is staff-only.
  const exportRoute = read("src/app/api/admin/export/route.ts")
  assert.match(
    exportRoute,
    /role !== "ADMIN" && role !== "MAINTAINER"/,
    "the export route must stay gated to staff",
  )

  // Webhooks verify signatures timing-safely and fail closed on a missing secret.
  const razorpay = read("src/app/api/webhooks/razorpay/route.ts")
  assert.match(razorpay, /timingSafeEqual/, "razorpay signature check must be timing-safe")
  const gform = read("src/app/api/webhooks/gform/route.ts")
  assert.match(gform, /if \(!secret \|\| !header\) return false/, "gform webhook must fail closed")

  // Cron routes fail closed when CRON_SECRET is unset.
  for (const cron of ["gform-sync", "payment-reminder"]) {
    const src = read(`src/app/api/cron/${cron}/route.ts`)
    assert.match(src, /if \(!cronSecret/, `${cron} must fail closed without CRON_SECRET`)
  }

  // No raw SQL and no innerHTML anywhere in app code.
  // (Spot-checked here; the full sweep is in the PR description.)
  const renderer = read("src/lib/tiptap-renderer.tsx")
  assert.doesNotMatch(renderer, /dangerouslySetInnerHTML/, "blog rendering must stay React-node based")
}

console.log("✅ check-security passed")
