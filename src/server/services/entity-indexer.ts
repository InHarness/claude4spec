/**
 * M29 EntityIndexerService — rebuilds the derived SQLite index from the
 * committed entity files. Hybrid SQLite-primary indexer modelled on
 * SectionIndexerService (M06): queries go to the DB, no in-memory map.
 *
 *   - indexAll()      full rebuild at boot, dependency-ordered (tags.json → the
 *                     `dependsOn` topological order of the ACTIVE modules).
 *                     Awaited BEFORE app.listen(); does NOT broadcast (no client
 *                     connected).
 *
 * 0.2.2: neither the order nor the table names are hardcoded here any more. The
 * order comes from each module's declared `dependsOn` (so `dto` precedes
 * `endpoint` because `endpoint` says so) and the table from `compositionOf(module)` in its
 * manifest — so a plugin-contributed type is cleared and rebuilt on exactly the
 * same path as a built-in one, instead of being silently missing from three
 * hand-maintained parallel arrays.
 *   - schedulePage()  debounced (300ms) incremental reindex of one file on watch.
 *   - handleUnlink()  remove the row + junction cascades, broadcast delete.
 *
 * Restore goes through the index path: HostEntityWriter(capture=false) so the
 * rebuild does NOT write entity_version rows (the boot acceptance criterion) and
 * service mutations run with writeFile=false (never re-write the files we read).
 */

import type Database from 'better-sqlite3';
import type { EntityStore } from './entity-store.js';
import type { EntitiesWatcher } from '../fs/entities-watcher.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { TagsService } from './tags.js';
import type { RawEntityReader, RawEntityType } from '../discovery/raw-entity-reader.js';
import type { RestoreContext } from '../serialization/types.js';
import { topoSortModules } from '../core/plugin-host/entity-order.js';
import { compositionOf } from '../../shared/plugin-host/composition.js';
import { HostEntityWriter } from './entity-writer.js';
import { projectStamp, safeTable } from './system-stamp-projection.js';
import { readSystemFields } from '../serialization/system-fields.js';
import {
  readPayloadVersion,
  stripPayloadVersion,
  upgradePayload,
} from '../serialization/payload-upgrade.js';

export class EntityIndexerService {
  private debounceMs = 300;
  private pending = new Map<string, NodeJS.Timeout>();

  constructor(
    private db: Database.Database,
    private store: EntityStore,
    private watcher: EntitiesWatcher,
    private ws: WsEmitter,
    private host: PluginHost,
    private tags: TagsService,
    private reader: RawEntityReader,
  ) {}

  // ─── index-path restore (no version capture, no file writes) ──────────────

  private indexCtx(): RestoreContext {
    return {
      reader: this.reader,
      // `versions: null` alongside `capture: false` — the rebuild reconstructs
      // the index from files it already trusts, so it captures nothing, and the
      // projection door must have no way to capture either.
      writer: new HostEntityWriter(this.host, this.tags, { capture: false }, {
        db: this.db,
        store: this.store,
        versions: null,
      }),
      releaseId: null,
      actor: 'user',
    };
  }

  // ─── boot full rebuild ────────────────────────────────────────────────────

  /**
   * The ACTIVE modules in declared dependency order. Inactive types are absent —
   * their files are kept on disk, just not indexed.
   */
  private orderedModules(): Array<{ type: string; table?: string }> {
    return topoSortModules(this.host.listEntities(), (remaining) =>
      console.warn(
        `[entity-indexer] dependsOn cycle among [${remaining.join(', ')}] — ` +
          `indexing those types in displayOrder instead`,
      ),
    );
  }

  /**
   * A table name safe to interpolate into DDL/DML, or `null`.
   *
   * 0.2.4: the implementation MOVED to `system-stamp-projection.ts` — the stamp
   * projection interpolates a table name too, and one guard written twice is
   * one guard that drifts. This stays as a thin forwarder so the indexer's own
   * call sites read unchanged.
   */
  private safeTable(table: string | undefined, type: string): string | null {
    return safeTable(table, type);
  }

  /** True when `table` exists in this database. */
  private tableExists(table: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table);
    return row != null;
  }

  /**
   * Every entity table this project can address — ACTIVE modules plus merely
   * AVAILABLE (deactivated) ones.
   *
   * The rebuild must clear a deactivated type's rows even though it will not
   * refill them: the pre-0.2.2 code cleared all seven core tables
   * unconditionally, so switching to active-only left orphaned rows that nothing
   * would ever re-index or remove.
   *
   * 0.2.7 — their `entity_tag` rows are NO LONGER cleared with them. The clear
   * is now scoped to the types the rebuild will actually refill, so a deactivated
   * type's tag assignments survive and are still correct when it is reactivated;
   * wiping them made reactivation lose data the files never stopped describing.
   * The assignments outlive the entity rows in the meantime. That is safe only
   * because `entity_tag.entity_slug` carries no FK (it is polymorphic on
   * `entity_type`), so nothing cascades — but it is NOT free: every reader that
   * aggregates `entity_tag` has to scope itself to the active types, or it
   * reports entities under a type whose table it just watched go empty. Two did
   * not, and were corrected alongside this change: `RawEntityReader.listTags`
   * and `coOccurrenceFor`. `TagsService.countsByTagSlug` already filtered on
   * `host.listEntities()`, which is why `GET /api/tags` was right all along and
   * is the answer the discovery surfaces now agree with.
   */
  private clearableTables(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of this.host.listAvailable()) {
      const table = this.safeTable(compositionOf(m).mainTable, m.type);
      if (!table || seen.has(table)) continue;
      seen.add(table);
      out.push(table);
    }
    return out;
  }

  /**
   * Auxiliary tables declared by modules (`backend.auxTables`) — junctions and
   * side indexes whose rows are derived from the entity files and therefore have
   * to be cleared before a rebuild repopulates them.
   *
   * Drawn from `listAvailable()`, not `listEntities()`: a deactivated type's
   * junction rows are exactly as stale as its entity rows, and the entity tables
   * below are cleared on the same basis.
   */
  private auxTables(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of this.host.listAvailable()) {
      for (const declared of m.backend?.auxTables ?? []) {
        // Same identifier validation as the entity tables: these names come from
        // a plugin manifest and are interpolated into `db.exec`.
        const table = this.safeTable(declared, m.type);
        if (!table || seen.has(table)) continue;
        seen.add(table);
        out.push(table);
      }
    }
    return out;
  }

  async indexAll(): Promise<void> {
    const startedAt = performance.now();
    let count = 0;
    // ONE transaction for the whole rebuild: clear the derived entity/tag/junction
    // tables (children before parents), then rebuild from the files. The inner
    // per-entity `db.transaction()` (service upserts, indexTagsFile) nest as
    // SAVEPOINTs, so a bad file still rolls back just its own savepoint (M29 edge
    // m29edge1: skip + warn, the rest continues) while everything else commits with a
    // SINGLE WAL fsync instead of one per entity — the dominant cost of the build.
    // entity_version (the log) and section_entity_link (derived from pages) are NOT
    // cleared. The whole restore chain is synchronous, so it fits in one transaction.
    const ordered = this.orderedModules();
    this.db
      .transaction(() => {
        // Children before parents. Entity tables are cleared in REVERSE dependency
        // order (dependents first), so a dependent's FK never blocks the parent's
        // DELETE. Table names come from the derived descriptor, so an active plugin type is
        // cleared too — the old hardcoded list silently left plugin rows behind.
        // 0.2.7 — SCOPED to the types this rebuild will refill. The unscoped
        // `DELETE FROM entity_tag` used to take every assignment in the project,
        // including those of types outside the rebuild, and nothing put them back.
        // The scope rule is a property of the whole transaction, not of one
        // statement: when it closes, no row whose type lies outside the rebuild
        // may be missing — by explicit DELETE or by FK cascade (see the `tag`
        // reconcile below, which is the other half of the same rule).
        const rebuiltTypes = ordered.map((m) => m.type);
        if (rebuiltTypes.length > 0) {
          this.db
            .prepare(
              `DELETE FROM entity_tag WHERE entity_type IN (${rebuiltTypes.map(() => '?').join(', ')})`,
            )
            .run(...rebuiltTypes);
        }
        // Module-declared auxiliary tables (junctions, side indexes) before the
        // entity tables they hang off. The host does not know what any of them
        // mean — a module declares `backend.auxTables` and the rebuild clears
        // them. Rows would usually also cascade from the parent DELETE, but
        // clearing explicitly keeps the rebuild correct if an FK ever changes.
        for (const table of this.auxTables()) {
          if (!this.tableExists(table)) continue;
          this.db.exec(`DELETE FROM ${table};`);
        }
        // Ordered (active) tables first, dependents before their dependencies;
        // then any remaining addressable table — deactivated types included, so
        // their rows never linger as un-reindexable phantoms.
        const orderedTables = [...ordered]
          .reverse()
          .map((m) => this.safeTable(compositionOf(m).mainTable, m.type))
          .filter((t): t is string => t !== null);
        const clearOrder = [...orderedTables];
        for (const table of this.clearableTables()) {
          if (!clearOrder.includes(table)) clearOrder.push(table);
        }
        for (const table of clearOrder) {
          // A type may declare a table whose migration never ran (a plugin that
          // shipped no `backend.migrations`, or whose migration failed). Without
          // this check the DELETE throws, the WHOLE rebuild transaction rolls
          // back, and the error is swallowed by the boot catch — leaving every
          // entity in the project served from a permanently stale index.
          if (!this.tableExists(table)) {
            console.warn(
              `[entity-indexer] table '${table}' does not exist — skipping it in the ` +
                `rebuild (its type declared a table no migration created)`,
            );
            continue;
          }
          this.db.exec(`DELETE FROM ${table};`);
        }
        /**
         * 0.2.7 — `tag` is NOT cleared. `entity_tag.tag_slug` is a real FK with
         * `ON DELETE CASCADE`, enforced by the engine (`PRAGMA foreign_keys = ON`),
         * so emptying `tag` swept every assignment in the table — globally, for
         * every type, in scope or not — a few statements after the scoped DELETE
         * above had done its job correctly. Scoping that DELETE alone looks like
         * the fix and is not: it passes "the delete touched only its own types"
         * while the cascade still takes everything.
         *
         * The registry is RECONCILED instead of emptied (see `indexTagsFile`), so
         * the cascade fires only for tags that genuinely left `tags.json`. General
         * rule: a table whose clearing has effects beyond its own scope must not
         * be cleared.
         */
        this.indexTagsFile({ reconcile: true }); // tags first — so entity tag refs resolve to real rows
        for (const m of ordered) {
          const type = m.type as RawEntityType;
          for (const slug of this.store.listType(type)) {
            if (this.indexEntity(type, slug, false)) count += 1;
          }
        }
      })();
    const ms = Math.round(performance.now() - startedAt);
    console.log(`[entity-indexer] indexed ${count} entities from ${this.store.root} in ${ms}ms`);
  }

  // ─── incremental (file-watch) ─────────────────────────────────────────────

  schedulePage(relPath: string): void {
    const prev = this.pending.get(relPath);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.pending.delete(relPath);
      try {
        this.indexFromWatch(relPath);
      } catch (err) {
        console.error(`[entity-indexer] failed to index ${relPath}:`, err);
      }
    }, this.debounceMs);
    this.pending.set(relPath, timer);
  }

  async handleUnlink(relPath: string): Promise<void> {
    const prev = this.pending.get(relPath);
    if (prev) {
      clearTimeout(prev);
      this.pending.delete(relPath);
    }
    if (this.store.isTagsFile(relPath)) {
      // A true tags.json unlink is degenerate; do NOT mass-delete tags (would
      // cascade entity_tag). Keep the current tag index; warn.
      console.warn('[entity-indexer] tags.json unlinked — keeping tag index');
      return;
    }
    const parsed = this.store.parseRelPath(relPath);
    if (!parsed) return;
    const { type, slug } = parsed;
    // `getAvailable`, not `getEntity`: a file removed while its type is
    // DEACTIVATED must still have its row dropped. Gating on active-only left the
    // row behind while still broadcasting a delete — and since the rebuild no
    // longer touches inactive tables either, nothing would ever remove it.
    // A resolvable NAME is not an existing table — a module can declare one whose
    // migration never ran, which since 0.2.2 includes an envelope that failed to
    // load. `DELETE FROM` a missing table throws out of the watcher callback,
    // where nothing catches it.
    const named = this.safeTable(compositionOf(this.host.getAvailable(type))?.mainTable, type);
    const table = named && this.tableExists(named) ? named : null;
    if (!table) {
      console.warn(
        `[entity-indexer] ${relPath} unlinked but type '${type}' resolves to no table — ` +
          `the index row (if any) could not be removed`,
      );
      return; // no delete happened; do not broadcast one
    }
    this.db
      .transaction(() => {
        this.db
          .prepare(`DELETE FROM entity_tag WHERE entity_type = ? AND entity_slug = ?`)
          .run(type, slug);
        // endpoint_dto rows cascade via FK ON DELETE CASCADE.
        this.db.prepare(`DELETE FROM ${table} WHERE slug = ?`).run(slug);
      })();
    this.ws.broadcast({ kind: 'entity:indexed', type, slug, op: 'delete' });
  }

  private indexFromWatch(relPath: string): void {
    if (this.store.isTagsFile(relPath)) {
      this.indexTagsFile();
      this.ws.broadcast({ kind: 'tag:changed', slug: '' });
      return;
    }
    const parsed = this.store.parseRelPath(relPath);
    if (!parsed) return;
    if (this.indexEntity(parsed.type, parsed.slug, true)) {
      // broadcast handled inside indexEntity when reindex succeeds
    }
  }

  // ─── single-entity reindex ────────────────────────────────────────────────

  /** Returns true if the entity was (re)indexed; false if skipped (inactive/error). */
  private indexEntity(type: RawEntityType, slug: string, broadcast: boolean): boolean {
    if (!this.host.getEntity(type)) return false; // inactive type
    let snap: unknown;
    try {
      snap = this.store.read(type, slug);
    } catch (err) {
      console.warn(`[entity-indexer] skip ${type}/${slug}: ${(err as Error).message}`);
      return false;
    }

    /**
     * 0.2.9 — bring an older payload to the current shape BEFORE it reaches the
     * write path (brief item 12).
     *
     * Here and not inside `restore` because an upgrade must not look like a
     * mutation. This is a pure transform on data; everything downstream is the
     * write path that already suppresses both things a mutation would do — the
     * indexer's writer runs with `capture: false` and `versions: null`, so no
     * `entity_version` row, and `restoreEntity` puts the FILE's stamp on the
     * writer, so `updatedAt` keeps the value the file carried. Bumping a type's
     * `payloadVersion` therefore rewrites file shapes without rewriting anyone's
     * audit history.
     */
    let upgraded = false;
    try {
      const module = this.host.getEntity(type);
      if (module) {
        const result = upgradePayload(module, snap, readPayloadVersion(snap));
        snap = stripPayloadVersion(result.data);
        upgraded = result.upgraded;
        for (const warning of result.warnings) {
          console.warn(`[entity-indexer] ${type}/${slug}: ${warning}`);
        }
      } else {
        snap = stripPayloadVersion(snap);
      }
    } catch (err) {
      // A payload the chain cannot honestly produce is SKIPPED, not guessed at.
      // One such entity must not abort the rebuild of its siblings.
      console.warn(`[entity-indexer] skip ${type}/${slug}: ${(err as Error).message}`);
      return false;
    }

    try {
      // 0.2.2: `restore` no longer throws when a type has no registered entity
      // service — it returns `{op:'noop'}` so one unwritable type cannot abort a
      // whole restore. That makes a NOOP indistinguishable from a successful
      // index unless we check: without this, a type whose `backend.service` slot
      // is missing (or whose mount never called `registerEntityService`) reports
      // `indexed N entities` with zero warnings while its table — just emptied by
      // the clear pass — stays empty and every read of it comes back blank.
      const result = this.host.restore(type, snap, this.indexCtx());
      if (result.op === 'noop' && result.entity === null) {
        console.warn(
          `[entity-indexer] skip ${type}/${slug}: ` +
            (result.warnings?.join('; ') ?? 'restore reported noop with no entity'),
        );
        return false;
      }
    } catch (err) {
      console.warn(`[entity-indexer] restore failed ${type}/${slug}: ${(err as Error).message}`);
      return false;
    }
    /**
     * 0.2.4 — the file's timestamps are authoritative, so verify they actually
     * landed. `host.restore` already put them on the writer, and the six in-repo
     * services honour that; this catches the types whose SQL predates the rule.
     */
    const stamp = readSystemFields(snap);
    // `expectServiceWrote` — the restore above DID run a service mutation with
    // this stamp on the writer, so a surviving mismatch is the service ignoring
    // it, which is exactly what the warning claims.
    if (stamp) projectStamp(this.db, this.host, type, slug, stamp, { expectServiceWrote: true });

    /**
     * Rewrite the file ONCE, after the upgraded payload has actually landed.
     *
     * Idempotence needs no bookkeeping: `persist` stamps the current
     * `payloadVersion`, so the next read short-circuits in `upgradePayload` and
     * this branch is never reached again for this file. Deliberately after the
     * stamp projection above, so the regenerated file carries the timestamps the
     * old one did rather than the ones a mid-restore row briefly held.
     */
    if (upgraded) {
      try {
        this.store.persist(type, slug);
      } catch (err) {
        // The index is correct either way; the file is merely still in the old
        // shape and will be upgraded again next boot. Not worth failing an index.
        console.warn(`[entity-indexer] ${type}/${slug}: upgraded payload but could not rewrite the file: ${(err as Error).message}`);
      }
    }

    if (broadcast) this.ws.broadcast({ kind: 'entity:indexed', type, slug, op: 'upsert' });
    return true;
  }

  /**
   * Project `tags.json` onto the `tag` table.
   *
   * `reconcile: true` (the full rebuild) additionally DELETES the slugs that have
   * disappeared from the file — the half of the rebuild that used to be done by
   * emptying the table first. Reconciling is not the same operation: emptying
   * cascaded `entity_tag` away for every tag, reconciling cascades only for the
   * ones actually removed.
   *
   * The watch path leaves `reconcile` off. It is handed ONE changed file and has
   * no way to tell "this tag was deleted" from "this write has not landed yet",
   * and a wrong guess there cascades away real assignments; the next full rebuild
   * settles it.
   */
  private indexTagsFile(opts: { reconcile?: boolean } = {}): void {
    let tags;
    try {
      tags = this.store.readTags();
    } catch (err) {
      console.warn(`[entity-indexer] tags.json parse failed: ${(err as Error).message}`);
      return;
    }
    // `readTags()` answers `[]` for an absent file too. Reconciling against a file
    // that is not there would delete the whole registry (and cascade every
    // assignment) on a project that has not exported its tags to text yet.
    const reconcile = opts.reconcile === true && this.store.tagsFileExists();
    const upsert = this.db.prepare(
      `INSERT INTO tag (slug, name, color, description) VALUES (?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET name = excluded.name, color = excluded.color, description = excluded.description`,
    );
    this.db
      .transaction(() => {
        for (const t of tags) upsert.run(t.slug, t.name, t.color ?? null, t.description ?? null);
        if (!reconcile) return;
        const slugs = tags.map((t) => t.slug);
        if (slugs.length === 0) {
          // An EMPTY `tags.json` does not authorize emptying the registry. The
          // reconcile below deletes what the file no longer lists; with nothing
          // listed that degenerates into the unscoped `DELETE FROM tag` this
          // whole change exists to remove — and it would cascade away every
          // assignment in the project, including the ones the scoped DELETE
          // above deliberately spared. A truncated or mid-write file is
          // indistinguishable from a deliberately emptied one, and the two cost
          // wildly different amounts to get wrong: a stale tag row survives
          // until the next real edit (Tag CRUD already removes rows at deletion
          // time), whereas a wrong wipe takes data no file describes any more.
          console.warn(
            '[entity-indexer] tags.json lists no tags — skipping the registry reconcile ' +
              'rather than emptying `tag` (a cleared registry cascades every tag assignment away)',
          );
          return;
        }
        this.db
          .prepare(`DELETE FROM tag WHERE slug NOT IN (${slugs.map(() => '?').join(', ')})`)
          .run(...slugs);
      })();
  }
}
