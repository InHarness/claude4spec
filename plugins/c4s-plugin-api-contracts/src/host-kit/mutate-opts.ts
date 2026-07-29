/**
 * M29: options threaded through entity service mutations (create/update/remove/
 * upsert/link/unlink). Both default to the user-mutation behaviour.
 *
 * The index-reconstruction path (boot `indexAll()` / incremental reindex) sets
 * BOTH to false: it rebuilds the SQLite index FROM the files, so it must neither
 * capture an `entity_version` row nor write the file back (that would loop the
 * watcher and duplicate the version log).
 */
export interface MutateOpts {
  /** false ⇒ do NOT capture an `entity_version` row for this mutation. */
  capture?: boolean;
  /** false ⇒ do NOT (re)write the entity's JSON file for this mutation. */
  writeFile?: boolean;
}
