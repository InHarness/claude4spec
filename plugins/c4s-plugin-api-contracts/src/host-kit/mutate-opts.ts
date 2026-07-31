/**
 * M29: options threaded through entity service mutations (create/update/remove/
 * upsert/link/unlink). All default to the user-mutation behaviour.
 *
 * The index-reconstruction path (boot `indexAll()` / incremental reindex) sets
 * `capture` and `writeFile` to false: it rebuilds the SQLite index FROM the
 * files, so it must neither capture an `entity_version` row nor write the file
 * back (that would loop the watcher and duplicate the version log).
 */

/** 0.2.4: the two timestamps an entity FILE carries. ISO-8601 with ms, UTC. */
export interface SystemStamp {
  createdAt: string;
  updatedAt: string;
}

export interface MutateOpts {
  /** false ⇒ do NOT capture an `entity_version` row for this mutation. */
  capture?: boolean;
  /** false ⇒ do NOT (re)write the entity's JSON file for this mutation. */
  writeFile?: boolean;
  /**
   * 0.2.4: the timestamps to write, sourced from the entity file. Present on
   * the reindex/restore path, where the value must land in the column verbatim;
   * absent on a user mutation, where the service mints one via `resolveStamp`.
   */
  stamp?: SystemStamp;
}
