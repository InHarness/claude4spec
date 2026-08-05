import type { FileVersionService, FileChangedBy } from './file-version.js';
import type { FileSerializer } from './file-serializer.js';
import type { WatchSubscriber, WatchScope, WatchOrigin, WatchActor } from '../fs/watcher.js';
import { requireRootId } from '../fs/sources.js';

/**
 * M17 — `m17-capture`, the `capture`-phase subscriber.
 *
 * ONE subscription, registered on every `pages:<rootId>` source (releasable or
 * not) and every `artifacts:*` source, with `after: ['write-back']`. Capture has
 * no gate: it covers every observed file, and the `releasable` filter only
 * applies later, at `assignToRelease()`.
 *
 * It is the SOLE author of `file_version`. Services and routes no longer record
 * their own rows — they `markOrigin(...)` and then `flush(...)`, which drives
 * this subscriber before they respond. That is what keeps "one mutation, one
 * entry" true without any content-hash de-duplication.
 *
 * It never calls `suppress()`: it does not write into an observed directory.
 */
export class FileVersionCapture implements WatchSubscriber {
  constructor(
    private readonly versions: FileVersionService,
    /** rootId → the serializer bound to that root's directory. */
    private readonly serializers: Map<string, FileSerializer>,
    /** Reads the actor behind an in-flight server write, so `changed_by` keeps three values. */
    private readonly peekActor: (scope: WatchScope, source: string, relPath: string) => WatchActor | undefined,
  ) {}

  /**
   * `origin: 'external'` → `filesystem`. A server write reports the actor that
   * `markOrigin` recorded (an agent writing with its built-in Write tool is
   * external to the server, so it correctly lands as `filesystem`).
   */
  private changedBy(scope: WatchScope, source: string, relPath: string, origin: WatchOrigin): FileChangedBy {
    if (origin !== 'server') return 'filesystem';
    return this.peekActor(scope, source, relPath) ?? 'user';
  }

  async onChange(scope: WatchScope, source: string, relPath: string, origin: WatchOrigin): Promise<void> {
    const rootId = requireRootId(source);
    const serializer = this.serializers.get(rootId);
    if (!serializer) return;
    // `add` may be a genuinely new file (op=create) or a re-detection of one we
    // already have history for — `hasAny` is what distinguishes them.
    const op: 'create' | 'update' = this.versions.hasAny(relPath, rootId) ? 'update' : 'create';
    try {
      await this.versions.recordVersion(
        relPath,
        op,
        this.changedBy(scope, source, relPath, origin),
        undefined,
        serializer,
        rootId,
      );
    } catch (err) {
      // A late-phase subscriber that finds the file already gone skips it
      // idempotently rather than derailing the rest of the dispatch.
      console.warn(`[file-version] capture for ${rootId}:${relPath}:`, (err as Error).message);
    }
  }

  /**
   * Deletion writes a `file_version` row with `op = 'delete'` and the last known
   * content preserved — required to restore deleted pages and to build release
   * tombstones. The content is synthesized from the previous version, since the
   * file itself is already gone.
   */
  async onUnlink(scope: WatchScope, source: string, relPath: string, origin: WatchOrigin): Promise<void> {
    const rootId = requireRootId(source);
    const serializer = this.serializers.get(rootId);
    if (!serializer) return;
    try {
      await this.versions.recordVersion(
        relPath,
        'delete',
        this.changedBy(scope, source, relPath, origin),
        undefined,
        serializer,
        rootId,
      );
    } catch (err) {
      console.warn(`[file-version] delete capture for ${rootId}:${relPath}:`, (err as Error).message);
    }
  }
}
