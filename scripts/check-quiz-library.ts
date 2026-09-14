#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-quiz-library.ts
//
// A rehearsal run must not keep a show on the library forever, and deleting a
// played show must take its answers with it rather than strand them.
import assert from "node:assert"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(p, "utf8")

const library = read("src/app/(admin)/admin/quiz/page.tsx")
assert.match(library, /archivedAt: archivedView \? \{ not: null \} : null/, "the main library hides archived shows")

const actions = read("src/app/(admin)/admin/quiz/actions.ts")
assert.doesNotMatch(actions, /has to stay/, "a played show can be deleted")
assert.match(
  actions,
  /tx\.response\.deleteMany\(\{ where: \{ sessionId: \{ in: runIds \} \} \}\)[\s\S]*tx\.quizSession\.deleteMany[\s\S]*tx\.presentation\.delete/,
  "deleting a show removes answers and runs in the same transaction",
)
assert.match(actions, /export async function deleteQuizRun[\s\S]*?requireAdmin\(\)/, "deleting a run is ADMIN only")
assert.match(actions, /export async function setPresentationArchived[\s\S]*?requireStaff\(\)/, "archiving is reversible, so staff may do it")

const results = read("src/app/(admin)/admin/quiz/[id]/results/page.tsx")
assert.match(results, /requireStaff\(\)/, "results are staff only")
assert.match(results, /entity=quiz-run/, "each run links to its download")

const exportRoute = read("src/app/api/admin/export/route.ts")
const guard = exportRoute.indexOf("if (!isDashboardStaff)")
const quizBranch = exportRoute.indexOf('"quiz-run"')
assert.ok(guard > 0 && quizBranch > guard, "the quiz-run export sits behind the dashboard-staff guard")

console.log("check-quiz-library: ok")
