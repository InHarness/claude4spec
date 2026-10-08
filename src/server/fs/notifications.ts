import type { WatchSubscriber, WatchScope, WatchOrigin } from './watcher.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import { requireRootId } from './sources.js';

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
export function fileChangedNotifier(ws: WsEmitter): WatchSubscriber {
  const emit = (source: string, relPath: string, event: 'change' | 'unlink', origin: WatchOrigin): void => {
    ws.broadcast({ kind: 'file:changed', event, path: relPath, rootId: requireRootId(source), origin });
  };
  return {
    onChange: (_scope, source, relPath, origin) => emit(source, relPath, 'change', origin),
    onUnlink: (_scope, source, relPath, origin) => emit(source, relPath, 'unlink', origin),
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
 * ASSUMPTION:dev-0010 — the `plan:updated { planPath, threadId, version,
 * changedBy }` broadcast itself is made by `PlanService` at the end of its own
 * write chain, after its own capture: the service writes with `chain: false`
 * (its `file_version` row carries a `change_summary` the capture phase cannot
 * receive), and M40's `notification` phase runs before `capture`, so a bound
 * handler could not see the version. An in-band chain run by any other writer of
 * a plan file still refreshes the list (`plans:changed`).
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
