#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-deploy-skew.ts
//
// A tab open across a deploy posts Server Action ids from the build it loaded.
// The new server does not have them, and the user sees "Something went wrong"
// with no hint that a deploy is the cause -- on staging that was indistinguishable
// from a rejected sign-in. These four pieces are what turn that into a reload.
import assert from "node:assert"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(p, "utf8")

{
  const config = read("next.config.ts")
  assert.match(
    config,
    /deploymentId: process\.env\.APP_VERSION/,
    "next.config must set a deploymentId so Next can detect version skew",
  )
}

{
  // deploymentId is read at BUILD time and baked in. Without APP_VERSION in the
  // build stage it is undefined, every asset is unstamped, and the reload check
  // below can never fire -- silently, with nothing failing.
  const dockerfile = read("Dockerfile")
  const buildStage = dockerfile.slice(dockerfile.indexOf("AS build"), dockerfile.indexOf("AS run"))
  assert.match(buildStage, /ARG APP_VERSION/, "the build stage must receive APP_VERSION")
  assert.match(buildStage, /APP_VERSION=\$APP_VERSION/, "the build stage must export APP_VERSION to next build")
  const runStage = dockerfile.slice(dockerfile.indexOf("AS run"))
  assert.match(runStage, /APP_VERSION=\$APP_VERSION/, "the running server must report the same build")
}

{
  const boundary = read("src/app/error.tsx")
  assert.match(boundary, /dataset\.dplId/, "the error boundary must read the build the page was served from")
  assert.match(boundary, /\/api\/health/, "it must ask the server which build is running now")
  assert.match(boundary, /location\.reload\(\)/, "a stale build must reload rather than strand the user")
  // Reloading on every error, or on a build that already reloaded, is a loop that
  // looks like the site is broken.
  assert.match(boundary, /reloadedForBuild/, "the reload must be remembered so it happens at most once")
  assert.ok(
    boundary.indexOf("alreadyTried === loaded") < boundary.indexOf("location.reload()"),
    "the loop guard must be checked before reloading",
  )
}

{
  const health = read("src/app/api/health/route.ts")
  assert.match(health, /version: process\.env\.APP_VERSION/, "health must report the running build")
}

console.log("deploy-skew checks passed (deploymentId, Dockerfile build arg, reload-once boundary, health version)")
