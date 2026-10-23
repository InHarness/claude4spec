import type { QueryKey } from '@tanstack/react-query';
import type { WsEvent } from '../../shared/types.js';

/**
 * 2.1.45 (M17 L5 m17ui001 "Stan → Zapytania") — the module's map "WS event →
 * query key" for the release diff. Every event below invalidates the broad
 * `['release-diff']` prefix, which covers both the Compare tab's diff
 * (`['release-diff', <from>, 'current']`) and the unreleased counter
 * (`['release-diff', <newest>, 'current', { summaryOnly: true }]`), so the
 * counter is refreshed by exactly the same events as the Compare tab.
 *
 * Restore has no event of its own — its writes arrive as entity and page
 * changes. A git state change made outside the app (commit, checkout, merge
 * from the terminal) emits nothing, because `.git` is not watched: the counter
 * shows it on the next fetch of the screen.
 */
export const RELEASE_DIFF_KEY = ['release-diff'] as const;

export const RELEASE_DIFF_INVALIDATING_EVENTS = [
  'file:changed',
  'entity:changed',
  'tag:changed',
  'page:renamed',
  'pages:frontmatter-changed',
  'release:created',
  'release:updated',
  'git:status-changed',
] as const satisfies ReadonlyArray<WsEvent['kind']>;

const EVENTS: ReadonlySet<string> = new Set(RELEASE_DIFF_INVALIDATING_EVENTS);

/** The release-diff keys a WS event invalidates — `[['release-diff']]` or none. */
export function releaseDiffKeysFor(kind: WsEvent['kind']): QueryKey[] {
  return EVENTS.has(kind) ? [[...RELEASE_DIFF_KEY]] : [];
}
