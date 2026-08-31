// Locks the authorization surface of the recruitment module so it cannot drift as
// actions are added: npx tsx scripts/check-recruitment-guards.ts
//
// Mirrors scripts/check-role-guards.ts, but for src/app/(recruitment). Statically
// parses every "use server" file and asserts:
//   1. no exported recruitment action is unguarded,
//   2. every guard names an action that exists in the capability matrix,
//   3. the actions the spec withholds from JCs are guarded by capabilities that
//      genuinely exclude JC, and
//   4. the recruitment area never imports the admin dashboard's guards, which
//      would couple the two permission systems the spec requires be independent.
import assert from "node:assert"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { CAPABILITIES, can, type RecruitmentAction } from "../src/lib/recruitment/permissions"

const RECRUITMENT_DIR = "src/app/(recruitment)"

// Exported actions that must NOT be reachable by a JC, whatever guard they use.
// These are the spec's explicit withholdings.
// Ten actions were removed from this list along with the code behind them, which
// no component had ever called: reopenSession, reverseGdBypass, editCandidate,
// reassignCandidate, addCandidatesToGroup, assignGroupStaff, archiveGroup,
// voidEvaluation, setAttendance and listCycles. They were guarded and audited
// correctly, and entirely unreachable. Withholding an action from a JC means
// nothing when nobody can invoke it at all.
// An action belongs here when at least one capability it guards on excludes a JC.
//
// For the dynamically-dispatched actions (moveCandidateStage, setCandidateResult)
// that is deliberately the weaker claim the static check can support: a JC may call
// them, but only for the destinations it holds the capability for -- advance and
// hold -- while bypass, withdraw, disqualify, finalise and reconsider stay shut.
//
// `createGroup` is the interesting one. It guards on group.create, which a JC now
// holds, AND on interview.conduct, which it does not, because creating a PI group
// IS starting an interview. Its presence here is therefore an automatic assertion
// that the second guard still exists: delete that line and this check goes red.
const JC_MUST_NOT_REACH = new Set([
  "bypassGd", "moveCandidateStage", "setCandidateResult",
  "createGroup",
  "saveSheetSource",
])

// Actions a JC legitimately performs. The session lifecycle is here because a JC
// now runs its own group discussions end to end rather than assisting someone
// else's, and the imports because refetching the responses sheet is theirs too.
const JC_MAY_REACH = new Set([
  "saveEvaluationDraft", "submitEvaluation",
  "startSession", "pauseSession", "resumeSession", "finishSession", "abortSession",
  "previewImport", "applyImport",
])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p)
  }
  return out
}

// fn name -> the recruitment action(s) its guards name.
//
// Two forms count as naming a capability:
//   · a literal guard call — require*(cycleId, "cycle.configure")
//   · an `// @recruitment-guard a, b, c` annotation above the export, for actions
//     whose required capability depends on their arguments (a stage move demands a
//     different capability per destination). The annotation is validated against
//     the matrix, so it documents rather than excuses the dynamic dispatch.
function guardsInFile(src: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const lines = src.split("\n")
  let current: string | null = null
  let depth = 0
  let pendingAnnotation: string[] = []

  for (const line of lines) {
    const annotation = line.match(/@recruitment-guard\s+(.+)$/)
    if (annotation) {
      pendingAnnotation = annotation[1]
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
      continue
    }

    const decl = line.match(/export async function (\w+)/)
    if (decl) {
      current = decl[1]
      depth = 0
      map.set(current, [...pendingAnnotation])
      pendingAnnotation = []
      continue
    }
    if (!current) continue

    // Stop attributing guards once the function body has closed.
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0)

    const guard = line.match(
      /require(?:RecruitmentAction|GroupAccess|CycleRole)\([^,]+,\s*["']([\w.]+)["']/,
    )
    if (guard) map.get(current)!.push(guard[1])

    if (depth < 0) current = null
  }
  return map
}

const files = walk(RECRUITMENT_DIR)
const actionFiles = files.filter((f) => readFileSync(f, "utf8").includes('"use server"'))
assert.ok(
  actionFiles.length >= 4,
  `expected several recruitment action files, found ${actionFiles.length}`,
)

const all = new Map<string, string[]>()
for (const file of actionFiles) {
  const src = readFileSync(file, "utf8")
  const exported = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1])
  const guards = guardsInFile(src)

  for (const fn of exported) {
    const named = guards.get(fn) ?? []
    // 1. no unguarded exported action. A recruitment action that reaches Prisma
    //    without naming a capability is exactly the drift this check exists for.
    assert.ok(
      named.length > 0,
      `${file}: exported action "${fn}" names no recruitment capability — add a require*(cycleId, "action") guard`,
    )
    all.set(fn, named)
  }
}

// 2. every named action exists in the capability matrix (catches typos, which
//    would otherwise silently deny or — worse — be treated as unknown).
for (const [fn, actions] of all) {
  for (const action of actions) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(CAPABILITIES, action),
      `"${fn}" guards on "${action}", which is not in CAPABILITIES`,
    )
  }
}

// 3. the spec's withholdings hold, resolved through the matrix rather than trusted
//    from a comment. An action is JC-reachable only if EVERY guard admits a JC.
for (const fn of JC_MUST_NOT_REACH) {
  const actions = all.get(fn)
  assert.ok(actions, `expected recruitment action "${fn}" to exist (renamed? update JC_MUST_NOT_REACH)`)
  const jcCanReach = actions.every((a) => can("JC", a as RecruitmentAction))
  assert.equal(
    jcCanReach,
    false,
    `"${fn}" is reachable by a JC via ${actions.join(" + ")} — it must not be`,
  )
}

for (const fn of JC_MAY_REACH) {
  const actions = all.get(fn)
  assert.ok(actions, `expected recruitment action "${fn}" to exist (renamed? update JC_MAY_REACH)`)
  for (const a of actions) {
    assert.ok(
      can("JC", a as RecruitmentAction),
      `"${fn}" guards on "${a}", which excludes JC — but a JC is meant to reach it`,
    )
  }
}

// 4. the recruitment area must not borrow the admin dashboard's guards. Mixing
//    requireStaff/requireAdmin in here would mean a dashboard role implied
//    recruitment authority, which is precisely what must stay independent.
for (const file of files) {
  const src = readFileSync(file, "utf8")
  for (const forbidden of ["requireStaff", "requireAdmin", "requireAuthor"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\s*\\(`).test(src),
      `${file}: uses ${forbidden}() — the recruitment area must resolve authority through ` +
        `src/lib/recruitment/authz.ts so dashboard and recruitment permissions stay independent`,
    )
  }
}

// The bypass rule is important enough to assert directly, not only via the sets.
assert.equal(can("JC", "candidate.bypassGd"), false, "a JC must never be able to bypass GD")
assert.ok(all.has("bypassGd"), "the GD bypass action must exist")
assert.deepEqual(all.get("bypassGd"), ["candidate.bypassGd"])

console.log(
  `recruitment guard checks passed (${all.size} actions across ${actionFiles.length} files, ` +
    `${JC_MUST_NOT_REACH.size} JC withholdings pinned)`,
)
