import { defineReaction } from '../fs/reactions.js';
import type { WatchSubscriber } from '../fs/watcher.js';
import { fileChangedNotifier, planChangedNotifier } from '../fs/notifications.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import { BASE_REACTION_ID } from '../../shared/root-kinds.js';

/**
 * 2.1.8 — the definitions of the reactions the core modules own, registered
 * once per process when this module is first imported (process start: the
 * server imports it through the project-context factory).
 *
 * Each definition declares its acceptance contract — the file-map formats it
 * runs on and the reactions it requires on the same kind — and a factory that
 * builds the handler from a project's {@link CoreReactionContext}. The owner of
 * each reaction is named in its id (`m06-…` is the sections module, M06).
 * Binding them to sources is the root-registry implementor's job, in the
 * context build; nothing here mounts or subscribes.
 */
export interface CoreReactionContext {
  ws: WsEmitter;
  /** M02 */
  frontmatterIndexer: WatchSubscriber;
  /** M06 — the write-back for a source: page roots go through the section indexer's stash, plans through the artifact injection. */
  anchorInjectionFor(source: string): WatchSubscriber;
  /** M06 */
  sectionIndexer: WatchSubscriber;
  /** M08 */
  todosIndexer: WatchSubscriber;
  /** M14 */
  linkIndexer: WatchSubscriber;
  /** M17 */
  versionCapture: WatchSubscriber;
  /** M29 */
  entityIndexer: WatchSubscriber;
  /** M29 */
  releaseIndexer: WatchSubscriber;
}

const NOOP: WatchSubscriber = { onChange: () => {}, onUnlink: () => {} };

let registered = false;

/** Idempotent: the definitions are registered once per process. */
export function registerCoreReactions(): void {
  if (registered) return;
  registered = true;

  // M02 — the base reaction, bound on every registry root (no kind can opt out).
  defineReaction<CoreReactionContext>({
    id: BASE_REACTION_ID,
    phase: 'notification',
    accepts: ['markdown', 'json', 'raw'],
    factory: (ctx) => fileChangedNotifier(ctx.ws),
  });

  // M02 — frontmatter projection (own writes and watcher), with initial sync and
  // `file:frontmatter-changed`.
  defineReaction<CoreReactionContext>({
    id: 'm02-frontmatter-indexer',
    phase: 'projection',
    accepts: ['markdown'],
    factory: (ctx) => ctx.frontmatterIndexer,
  });

  // M06 — `<!-- anchor: … -->` lines above headings; never touches the
  // frontmatter block. On a page root the section indexer mints them; on a plan
  // the anchors only serve `edits[]` addressing and are unique per plan.
  defineReaction<CoreReactionContext>({
    id: 'm06-anchor-injection',
    phase: 'write-back',
    accepts: ['markdown'],
    factory: (ctx) => ({
      onChange: (scope, source, relPath, origin) => ctx.anchorInjectionFor(source).onChange(scope, source, relPath, origin),
      onUnlink: (scope, source, relPath, origin) => ctx.anchorInjectionFor(source).onUnlink(scope, source, relPath, origin),
    }),
  });

  // M06 — `section_index`. Requires anchor injection on the same kind.
  defineReaction<CoreReactionContext>({
    id: 'm06-section-indexer',
    phase: 'projection',
    accepts: ['markdown'],
    requires: ['m06-anchor-injection'],
    factory: (ctx) => ctx.sectionIndexer,
  });

  // M08 — `TodosIndexerService`, in-memory `(rootId, path)`, `todos:changed`.
  defineReaction<CoreReactionContext>({
    id: 'm08-todos-indexer',
    phase: 'projection',
    accepts: ['markdown'],
    factory: (ctx) => ctx.todosIndexer,
  });

  // M14 — the link index runs after the section indexer where that one is bound.
  defineReaction<CoreReactionContext>({
    id: 'm14-link-indexer',
    phase: 'projection',
    after: ['m06-section-indexer'],
    accepts: ['markdown'],
    factory: (ctx) => ctx.linkIndexer,
  });

  // M14 — `@a.md` → `@b.md` after a move. A move is not observable from a single
  // file event, so the watcher-side handler does nothing; the binding is what
  // admits a root to `renameSync` (the move primitive's propagation).
  defineReaction<CoreReactionContext>({
    id: 'm14-rename-sync',
    phase: 'write-back',
    accepts: ['markdown'],
    factory: () => NOOP,
  });

  // M17 — a `file_version` row via `FileVersionService`, keyed `(rootId, path)`,
  // after every write-back so the version carries the anchors.
  defineReaction<CoreReactionContext>({
    id: 'm17-capture',
    phase: 'capture',
    after: ['write-back'],
    accepts: ['markdown'],
    factory: (ctx) => ctx.versionCapture,
  });

  // M10 — requires capture on the same kind.
  defineReaction<CoreReactionContext>({
    id: 'm10-plan-updated',
    phase: 'notification',
    accepts: ['markdown'],
    requires: ['m17-capture'],
    factory: (ctx) => planChangedNotifier(ctx.ws),
  });

  // M29 — entity files → incremental reindex.
  defineReaction<CoreReactionContext>({
    id: 'm29-entity-indexer',
    phase: 'projection',
    accepts: ['json'],
    factory: (ctx) => ctx.entityIndexer,
  });

  // M29 — rebuilds the `spec_release` cache from the `releases` root's files.
  defineReaction<CoreReactionContext>({
    id: 'm29-release-cache',
    phase: 'projection',
    accepts: ['json'],
    factory: (ctx) => ctx.releaseIndexer,
  });
}
