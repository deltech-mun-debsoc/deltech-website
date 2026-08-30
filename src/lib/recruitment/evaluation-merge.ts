// Which of two views of the same evaluator's row is authoritative.
//
// The scoring form has two sources of truth: the row the server confirmed to this
// client on its last save, and the row the latest RSC payload carries. It needs
// both. Without the local one, a refresh that had not yet seen the write re-seeds
// every field from the pre-write row and visibly undoes what was just typed --
// a revision always mints a new row id, and the form re-seeds on id change.
// Without the server one, another evaluator's revision, or your own from a second
// tab, would never appear.
//
// Pure and separate from the component so the rule can actually be exercised:
// getting it wrong in the other direction silently swallows a real update, which
// is the failure mode that would be hardest to notice.
export interface VersionedRow {
  version: number
}

export function newerOf<T extends VersionedRow>(local: T | null, server: T | null): T | null {
  if (!local) return server
  if (!server) return local
  // Ties go to the server: same version means the same write, and the server's
  // copy is the one with every field on it.
  return local.version > server.version ? local : server
}
