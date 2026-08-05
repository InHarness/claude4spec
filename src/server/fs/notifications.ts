import type { WatchSubscriber, WatchScope, WatchOrigin } from './watcher.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import { requireRootId } from './sources.js';

/**
 * `notification`-phase subscribers.
 *
 * M40 provides the broadcast MECHANISM only — the event catalog belongs to the
 * owners. Each source owner registers its own subscription here and emits the
 * event it declares, which is why there is one per source family rather than a
 * single collapsed `file:changed` discriminated after the fact.
 */

/**
 * M02 — owner of `file:changed` for every `pages:<rootId>` source.
 *
 * `origin` drives the client's behaviour: `'server'` is a silent content reload
 * with no dialog, `'external'` raises "File changed externally, reload?". Before
 * 0.2.10 the server-origin path was unreachable (nothing ever emitted it), so a
 * UI save produced no event at all.
 */
export function pageChangedNotifier(ws: WsEmitter): WatchSubscriber {
  const emit = (source: string, relPath: string, event: 'change' | 'unlink', origin: WatchOrigin): void => {
    ws.broadcast({ kind: 'file:changed', event, path: relPath, rootId: requireRootId(source), origin });
  };
  return {
    onChange: (_scope, source, relPath, origin) => emit(source, relPath, 'change', origin),
    onUnlink: (_scope, source, relPath, origin) => emit(source, relPath, 'unlink', origin),
  };
}

/**
 * M30 — read-only `.html` preview. Registered with the mechanical filter
 * `**\/*.html`, so it is the only reaction `.html` files get: no anchors (M06),
 * no XML references (M19), no `file_version` capture (M17). It just tells the
 * open `HtmlViewer` iframe for `(rootId, relPath)` to refresh.
 *
 * Before 0.2.10 this refresh was an incidental side effect of someone else's
 * event; now it is a declared reaction.
 */
export function htmlPreviewNotifier(ws: WsEmitter): WatchSubscriber {
  const emit = (source: string, relPath: string, event: 'change' | 'unlink', origin: WatchOrigin): void => {
    ws.broadcast({ kind: 'file:changed', event, path: relPath, rootId: requireRootId(source), origin });
  };
  return {
    onChange: (_scope, source, relPath, origin) => emit(source, relPath, 'change', origin),
    onUnlink: (_scope, source, relPath, origin) => emit(source, relPath, 'unlink', origin),
  };
}

/**
 * M36 — one owner per artifact source, each emitting the event it declares.
 *
 * `briefs:changed` carries `origin` because BriefEditor has the same
 * reload-or-confirm flow Pages does. `plans:changed` does not — PlanPage just
 * refetches. Patches have no open-editor equivalent, so they emit nothing here
 * and rely on the frontmatter projection's `patches:changed`.
 */
export function artifactChangedNotifier(
  ws: WsEmitter,
  kind: 'brief' | 'patch' | 'plan',
): WatchSubscriber | null {
  if (kind === 'brief') {
    return {
      onChange: (_s: WatchScope, _src: string, relPath: string, origin: WatchOrigin) =>
        ws.broadcast({ kind: 'briefs:changed', path: relPath, origin }),
      onUnlink: (_s: WatchScope, _src: string, relPath: string) =>
        ws.broadcast({ kind: 'briefs:changed', path: relPath, origin: 'external' }),
    };
  }
  if (kind === 'plan') {
    return {
      onChange: (_s: WatchScope, _src: string, relPath: string) =>
        ws.broadcast({ kind: 'plans:changed', path: relPath }),
      onUnlink: (_s: WatchScope, _src: string, relPath: string) =>
        ws.broadcast({ kind: 'plans:changed', path: relPath }),
    };
  }
  return null;
}
