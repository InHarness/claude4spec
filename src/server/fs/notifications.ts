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
 * `m10-plan-updated` — M10's notification for a plan file changed outside the
 * plan service (an agent or user editing the file on disk). The service's own
 * writes broadcast `plan:updated { planPath, threadId, version, changedBy }`
 * themselves, since only they know the thread and the version they wrote.
 */
export function planChangedNotifier(ws: WsEmitter): WatchSubscriber {
  return {
    onChange: (_s: WatchScope, _src: string, relPath: string) => ws.broadcast({ kind: 'plans:changed', path: relPath }),
    onUnlink: (_s: WatchScope, _src: string, relPath: string) => ws.broadcast({ kind: 'plans:changed', path: relPath }),
  };
}
