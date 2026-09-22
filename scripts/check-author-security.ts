// Exercise the actual server actions and shared role guard with an isolated
// database/session boundary. No live account or database is used.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { runInNewContext } from "node:vm"
import ts from "typescript"

function load(relativePath: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(resolve(relativePath), "utf8")
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} as Record<string, (...args: any[]) => Promise<any>> }
  runInNewContext(outputText, {
    module, exports: module.exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  })
  return module.exports
}

async function main() {
  let session: { user: { id: string; role: string } } | null = null
  let reads = 0
  let writes = 0
  let owner = "writer"
  let status = "DRAFT"
  const guards = load("src/lib/authz.ts", {
    "next/navigation": { redirect: () => { throw new Error("Redirect") } },
    "@/lib/auth": { auth: async () => session },
  })
  const actions = load("src/app/(author)/write/[id]/actions.ts", {
    "@/lib/authz": guards,
    "@/lib/prisma": { prisma: { post: {
      findUnique: async () => { reads++; return { authorId: owner, slug: "existing-post", status } },
      update: async () => { writes++; return {} },
    } } },
  })
  const draft = { title: "Story", subtitle: "", contentJson: {}, tags: [], readMin: 1 }
  for (const role of [null, "MEMBER", "REGISTERER", "SUB_MAINTAINER"]) {
    session = role ? { user: { id: "writer", role } } : null
    reads = writes = 0
    assert.equal((await actions.saveDraft("post", draft)).success, false)
    assert.equal((await actions.submitPost("post")).success, false)
    assert.equal(reads, 0, `${role}: denied before reading owned content`)
    assert.equal(writes, 0, `${role}: a former author must not mutate their retained draft`)
  }
  for (const role of ["AUTHOR", "ADMIN", "MAINTAINER"]) {
    session = { user: { id: "writer", role } }
    owner = "someone-else"
    writes = 0
    assert.equal((await actions.saveDraft("post", draft)).success, false)
    assert.equal((await actions.submitPost("post")).success, false)
    assert.equal(writes, 0, `${role}: authoring does not bypass ownership`)
    owner = "writer"
    status = "PUBLISHED"
    assert.equal((await actions.saveDraft("post", draft)).success, false)
    assert.equal((await actions.submitPost("post")).success, false)
    assert.equal(writes, 0, `${role}: published content remains immutable to these actions`)
    status = "DRAFT"
    assert.equal((await actions.saveDraft("post", draft)).success, true)
    assert.equal((await actions.submitPost("post")).success, true)
    assert.equal(writes, 2, `${role}: legitimate author workflow remains available`)
  }
  console.log("author security checks passed (role revocation, ownership, publication, allowed roles)")
}
main().catch((error) => { console.error(error); process.exit(1) })
