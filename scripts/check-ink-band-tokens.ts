// Runnable check: npx tsx scripts/check-ink-band-tokens.ts
//
// bg-foreground/text-background are the *theme* tokens: they swap in .dark, so
// pairing them was never a fixed "dark ink band" -- in dark mode it flips to a
// white band with dark text (this shipped as the footer going white, and every
// gold/paper label built to sit on the band going low-contrast). The real fixed
// pair is bg-ink/text-paper (see globals.css). This check fails the build if the
// broken pairing reappears anywhere under src/, so the fix in PR "dark mode round
// 2" can't silently regress via copy-paste.
import assert from "node:assert"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full)
  }
  return out
}

const offenders: string[] = []
for (const file of walk(join(__dirname, "..", "src"))) {
  const lines = readFileSync(file, "utf8").split("\n")
  lines.forEach((line, i) => {
    if (/\bbg-foreground\b/.test(line) && /\btext-background\b/.test(line)) {
      offenders.push(`${file}:${i + 1}`)
    }
  })
}

assert.deepEqual(
  offenders,
  [],
  `Found bg-foreground + text-background paired on one line (breaks in dark mode -- use bg-ink/text-paper instead):\n${offenders.join("\n")}`,
)

console.log("ink-band token check passed")
