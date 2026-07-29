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
 * `endpoint` because `endpoint` says so) and the table from `module.table` in its
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
import type { RawEntityReader, RawEntityType } from '../domain/raw-entity-reader.js';
import type { RestoreContext } from '../serialization/types.js';
import { topoSortModules } from '../core/plugin-host/entity-order.js';
import { HostEntityWriter } from './entity-writer.js';

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
      writer: new HostEntityWriter(this.host, this.tags, { capture: false }),
      releaseId: null,
      actor: 'user',
    };
  }

  // ─── boot full rebuild ────────────────────────────────────────────────────

  /**
   * The ACTIVE modules in declared dependency order. Inactive types are absent —
   * their files are kept on disk, just not indexed.
   */
  private orderedModules(): Array<{ type: string; table: string }> {
    return topoSortModules(this.host.listEntities(), (remaining) =>
      console.warn(
        `[entity-indexer] dependsOn cycle among [${remaining.join(', ')}] — ` +
          `indexing those types in displayOrder instead`,
      ),
    );
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
        // DELETE. Table names come from `module.table`, so an active plugin type is
        // cleared too — the old hardcoded list silently left plugin rows behind.
        this.db.exec('DELETE FROM entity_tag;');
        // The endpoint↔dto junction is still host-side in 0.2.2 (brief item 5 moves
        // it into the api-contracts envelope, at which point this line goes with it).
        // Rows would also cascade from `DELETE FROM endpoint`, but clearing it
        // explicitly keeps the rebuild correct if that FK ever changes.
        this.db.exec('DELETE FROM endpoint_dto;');
        for (const m of [...ordered].reverse()) {
          this.db.exec(`DELETE FROM ${m.table};`);
        }
        this.db.exec('DELETE FROM tag;');
        this.indexTagsFile(); // tags first — so entity tag refs resolve to real rows
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
    this.db
      .transaction(() => {
        this.db
          .prepare(`DELETE FROM entity_tag WHERE entity_type = ? AND entity_slug = ?`)
          .run(type, slug);
        // endpoint_dto rows cascade via FK ON DELETE CASCADE.
        const table = this.host.getEntity(type)?.table;
        if (table) this.db.prepare(`DELETE FROM ${table} WHERE slug = ?`).run(slug);
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
    try {
      this.host.restore(type, snap, this.indexCtx());
    } catch (err) {
      console.warn(`[entity-indexer] restore failed ${type}/${slug}: ${(err as Error).message}`);
      return false;
    }
    if (broadcast) this.ws.broadcast({ kind: 'entity:indexed', type, slug, op: 'upsert' });
    return true;
  }

  private indexTagsFile(): void {
    let tags;
    try {
      tags = this.store.readTags();
    } catch (err) {
      console.warn(`[entity-indexer] tags.json parse failed: ${(err as Error).message}`);
      return;
    }
    const upsert = this.db.prepare(
      `INSERT INTO tag (slug, name, color, description) VALUES (?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET name = excluded.name, color = excluded.color, description = excluded.description`,
    );
    this.db
      .transaction(() => {
        for (const t of tags) upsert.run(t.slug, t.name, t.color ?? null, t.description ?? null);
      })();
  }
}
