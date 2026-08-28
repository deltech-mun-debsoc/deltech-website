#!/usr/bin/env tsx
// Realtime is a progressive enhancement, and it must fail like one.
//
// src/lib/supabase.ts used to call createClient() at module scope. createClient
// throws on a missing OR malformed URL, and a module-scope throw is
// unrecoverable: it takes down every component that imports the module, on the
// client, during hydration. One bad NEXT_PUBLIC_SUPABASE_URL therefore
// white-screened the homepage, the availability board, both quiz surfaces and
// every recruitment page, with no error digest to trace it by.
//
// These assertions pin the shape that keeps a bad value a disabled feature.
import assert from "node:assert"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const lib = readFileSync("src/lib/supabase.ts", "utf8")

// The client is built inside a function, never at module scope.
assert.match(lib, /export function getSupabase/, "the client must be created lazily")
assert.doesNotMatch(
  lib,
  /^export const supabase = createClient/m,
  "createClient must not run at module scope: it throws and cannot be caught by callers",
)

// A malformed value must be rejected here rather than inside createClient, so
// callers get null instead of an exception.
assert.match(lib, /https\?:\\\/\\\//, "the URL must be validated before createClient sees it")
assert.match(lib, /return null/, "an unusable config must yield null, not a throw")

// Every consumer must handle the null.
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

const consumers = walk("src").filter(
  (f) => f !== "src/lib/supabase.ts" && readFileSync(f, "utf8").includes('from "@/lib/supabase"'),
)
assert.ok(consumers.length > 0, "expected at least one realtime consumer")

for (const file of consumers) {
  const src = readFileSync(file, "utf8")
  assert.match(
    src,
    /getSupabase\(\)/,
    `${file} must obtain the client through getSupabase()`,
  )
  // Either an early return or a conditional: what matters is that the result is
  // never dereferenced unguarded.
  assert.ok(
    /if \(!supabase\) return/.test(src) || /supabase\s*\?/.test(src) || /supabase &&/.test(src),
    `${file} must handle getSupabase() returning null`,
  )
}

console.log(`realtime-optional checks passed (${consumers.length} consumers guarded)`)
