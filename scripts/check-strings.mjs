#!/usr/bin/env node
// Two gates in one pass:
//   1. No hardcoded user-visible strings in .tsx outside the allowed list.
//   2. No em dashes anywhere under src/ (excluding generated output).
//
// Allowed escape: purely decorative / symbol-only content (icons, separators, empty strings).
// Everything else must go through t() from @/content/strings or getContent() from @/lib/settings.

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

// Files / directories that ARE allowed to contain raw strings
const ALLOWED_FILES = new Set([
  "src/content/strings.ts",
  "src/content/contentSchema.ts",
]);
// Directory prefixes that are skipped entirely (shadcn primitives — owned but generated)
const SKIP_DIRS = ["src/components/ui"];

// Attributes where hardcoded English is flagged
const FLAGGED_ATTRS = ["placeholder", "aria-label", "title", "alt"];

// `placeholder` is on that list for form fields, but next/image uses the same
// attribute name for an API enum with exactly two values. Neither is ever shown
// to a reader, so exempt those two literals and nothing else -- a placeholder of
// "type your name here" is still a violation, which is asserted by removing this
// set and watching the gallery's own `placeholder="blur"` come back as one.
const NON_COPY_ATTR_VALUES = new Set(['placeholder="blur"', 'placeholder="empty"']);

// Regex patterns that are violations
const ATTR_RE = new RegExp(
  `\\b(${FLAGGED_ATTRS.join("|")})="([A-Za-z][^"]{2,})"`,
  "g",
);

// JSX text node: >some english text< — must start with letter, multi-word or punctuated
// Excludes TypeScript generics like `>= FieldPath` or `>& VariantProps`
const TEXT_NODE_RE = />([A-Za-z][A-Za-z ]+ [A-Za-z][A-Za-z ,.'!?:–-]{2,})</g;

// Lines that are exempt even if they match the pattern
const EXEMPT_LINE_RE = /\{t\(|strings\.|getContent\(\)|\/\/|STRINGS\[|`|[&|=<>].*[A-Z][a-z]/;

// Walks every source file, not just .tsx, for the em-dash rule.
function walkAll(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== ".next" && e.name !== "generated") {
        files.push(...walkAll(full));
      }
    } else if (/\.(ts|tsx|mjs|js|css)$/.test(e.name)) {
      files.push(full);
    }
  }
  return files;
}

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== ".next" && e.name !== "generated") {
        files.push(...walk(full));
      }
    } else if (e.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

let violations = 0;

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (ALLOWED_FILES.has(rel)) continue;
  if (SKIP_DIRS.some((d) => rel.startsWith(d))) continue;

  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (EXEMPT_LINE_RE.test(line)) return;

    let m;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(line)) !== null) {
      if (NON_COPY_ATTR_VALUES.has(`${m[1]}="${m[2]}"`)) continue;
      console.error(`${rel}:${i + 1}  hardcoded ${m[1]}="${m[2]}"`);
      violations++;
    }

    TEXT_NODE_RE.lastIndex = 0;
    while ((m = TEXT_NODE_RE.exec(line)) !== null) {
      const text = m[1].trim();
      // Skip if it looks like a variable, number, or single word that could be a proper noun/tag
      if (/^\d/.test(text)) continue;
      if (text.split(" ").length < 2 && !/[.!?]/.test(text)) continue;
      console.error(`${rel}:${i + 1}  hardcoded text node: "${text}"`);
      violations++;
    }
  });
}

// ---------------------------------------------------------------------------
// Em dashes. The house style is that we do not use them, in copy or in
// comments: they were the loudest tell that the writing was machine-generated.
// A period, a comma, a colon or "·" always covers the job.
// ---------------------------------------------------------------------------
let dashes = 0;
for (const file of walkAll(SRC)) {
  const rel = relative(ROOT, file);
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (!line.includes("\u2014")) return;
    console.error(`${rel}:${i + 1}  em dash: ${line.trim().slice(0, 90)}`);
    dashes++;
  });
}

if (dashes > 0) {
  console.error(
    `\n❌ ${dashes} em dash(es) found. Use a period, comma, colon, or "·" instead.\n`,
  );
  process.exit(1);
}

if (violations > 0) {
  console.error(
    `\n❌ ${violations} hardcoded string(s) found. Use t() from @/content/strings or getContent() from @/lib/settings.\n` +
    `   Purely decorative/symbol-only content (icons, separators) is the one allowed escape.\n`,
  );
  process.exit(1);
}

console.log("✅ check:strings passed. No hardcoded literals and no em dashes.");
