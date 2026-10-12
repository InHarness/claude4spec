import type { WatchSubscriber, WatchScope, WatchOrigin } from './watcher.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { ReactionInput } from './reactions.js';
import { reactionRootId } from './sources.js';

/**
 * `notification`-phase subscribers.
 *
 * M40 provides the broadcast MECHANISM only — the event catalog belongs to the
 * owners.
 */

/**
 * `m02-file-changed` — the BASE reaction. The root-registry implementor (M02)
 * binds it on every registry root and no kind can opt out, so it has one owner
 * (before 2.1.8 M02 emitted it for pages and M36 its own events for artifacts).
 * The payload names the registry root — also `entities`, `releases`, `briefs`…
 *
 * `origin` drives the client's behaviour: `'server'` is a silent content reload
 * with no dialog, `'external'` raises "File changed externally, reload?". An
 * open `.html` preview (M30) reloads on this same event, narrowed client-side to
 * `**\/*.html` — M30 has no reaction of its own.
 */
export function fileChangedNotifier(ws: WsEmitter): {
  onChange(scope: WatchScope, source: string, relPath: string, origin: WatchOrigin, input?: ReactionInput): void;
  onUnlink(scope: WatchScope, source: string, relPath: string, origin: WatchOrigin, input?: ReactionInput): void;
} {
  // `rootId` comes from the binding's input, like every other registry reaction
  // (reactionRootId) — the source-name suffix is only the direct-call fallback.
  const emit = (
    source: string,
    relPath: string,
    event: 'change' | 'unlink',
    origin: WatchOrigin,
    input?: ReactionInput,
  ): void => {
    ws.broadcast({ kind: 'file:changed', event, path: relPath, rootId: reactionRootId(source, input), origin });
  };
  return {
    onChange: (_scope, source, relPath, origin, input) => emit(source, relPath, 'change', origin, input),
    onUnlink: (_scope, source, relPath, origin, input) => emit(source, relPath, 'unlink', origin, input),
  };
}

/**
 * `m10-plan-updated` — M10's notification, trigger `primitive` only (m10ws000):
 * the WATCHER never fires it. An edit of a plan file made outside the app is
 * announced by the base `file:changed { rootId: 'plans' }` (the client refetches
 * the plan list, detail and versions on it), because the payload of this
 * reaction names the author and provenance of a write, which an event from the
 * observed directory does not know.
 *
 * 2.1.14 (M10 m10ws000, jo0r7uh9) — the `plan:updated { planPath, threadId,
 * version, changedBy }` broadcast itself is made by `PlanService` as the last
 * step of its own sequence: file (written with the chain switched off, M42
 * 544jcpq5) → its own `recordVersion` with the caller's `changeSummary` (which
 * the capture phase cannot receive — the event knows no change summary) →
 * broadcast with the version just recorded. The definition therefore carries
 * the acceptance contract and the event shape only, and requires nothing; the
 * service's own write never fires it in-band. Should an in-band chain run on a
 * plan file anyway (a writer other than the service), this handler only
 * refreshes the list (`plans:changed`) — it never claims a version.
 */
export function planUpdatedNotifier(ws: WsEmitter): WatchSubscriber {
  const emit = (relPath: string, origin: WatchOrigin): void => {
    if (origin === 'external') return;
    ws.broadcast({ kind: 'plans:changed', path: relPath });
  };
  return {
    onChange: (_s: WatchScope, _src: string, relPath: string, origin: WatchOrigin) => emit(relPath, origin),
    onUnlink: (_s: WatchScope, _src: string, relPath: string, origin: WatchOrigin) => emit(relPath, origin),
  };
}
