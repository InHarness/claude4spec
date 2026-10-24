import type { InvalidateQueryFilters, Query } from '@tanstack/react-query';
import type { WsEvent } from '../../shared/types.js';
import { CURRENT_RELEASE_NAME } from '../../shared/entities.js';

/**
 * 2.1.45 (M17 L5 m17ui001 "Stan → Zapytania") — the module's map "WS event →
 * query key" for the release diff, split by what the event can change:
 *
 * - a **content** event (an entity, page, tag or the working tree changed)
 *   moves only `current`, so it refetches only the diffs whose one side is
 *   `current` — the Compare tab's `['release-diff', <from>, 'current']` and the
 *   unreleased counter `['release-diff', <newest>, 'current', { summaryOnly:
 *   true }]`. A release → release diff is frozen and is not refetched;
 * - a **release lifecycle** event (created, edited/renamed) can move any
 *   release, so it invalidates the whole `['release-diff']` prefix.
 *
 * Either way the counter is refreshed by exactly the same events as the
 * Compare tab. Restore has no event of its own — its writes arrive as entity
 * and page changes. A git state change made outside the app (commit, checkout,
 * merge from the terminal) emits nothing, because `.git` is not watched: the
 * counter shows it on the next fetch of the screen.
 *
 * A `file:changed` of a system root without a facade (briefs, patches, plans,
 * releases, entities) is not content of the diff — the watcher does not pass it
 * here. When a lifecycle and a content event meet in one batch window, the
 * prefix invalidation covers the narrower one (`wsBatcher`), so each query is
 * refetched once.
 */
const RELEASE_DIFF_KEY = ['release-diff'] as const;

export const RELEASE_DIFF_CONTENT_EVENTS = [
  'file:changed',
  'entity:changed',
  'tag:changed',
  'page:renamed',
  'pages:frontmatter-changed',
  'git:status-changed',
] as const satisfies ReadonlyArray<WsEvent['kind']>;

export const RELEASE_DIFF_LIFECYCLE_EVENTS = [
  'release:created',
  'release:updated',
] as const satisfies ReadonlyArray<WsEvent['kind']>;

const CONTENT: ReadonlySet<string> = new Set(RELEASE_DIFF_CONTENT_EVENTS);
const LIFECYCLE: ReadonlySet<string> = new Set(RELEASE_DIFF_LIFECYCLE_EVENTS);

/** A release-diff query with `current` on either side. */
function isCurrentReleaseDiff(query: Pick<Query, 'queryKey'>): boolean {
  const [, from, to] = query.queryKey;
  return from === CURRENT_RELEASE_NAME || to === CURRENT_RELEASE_NAME;
}

/** One queued invalidation: `id` dedupes it inside the watcher's batch window. */
export interface ReleaseDiffInvalidation {
  id: string;
  filters: InvalidateQueryFilters;
}

/** The release-diff invalidation a WS event triggers, or `null`. */
export function releaseDiffInvalidationFor(kind: WsEvent['kind']): ReleaseDiffInvalidation | null {
  if (LIFECYCLE.has(kind)) return { id: 'release-diff:all', filters: { queryKey: [...RELEASE_DIFF_KEY] } };
  if (CONTENT.has(kind)) {
    return {
      id: 'release-diff:current',
      filters: { queryKey: [...RELEASE_DIFF_KEY], predicate: isCurrentReleaseDiff },
    };
  }
  return null;
}

/**
 * 2.1.46 (M17 L5 m17ui001 "Stan → Zapytania") — the Shadows tab's delta
 * `['shadow-diff', <ref>]` (`GET /api/shadow-diff`), `<ref>` being the shadow
 * id. It moves with HEAD and with the shadow's ref, so its one invalidating
 * event is `git:status-changed`, on the whole `['shadow-diff']` prefix.
 */
export const SHADOW_DIFF_KEY = ['shadow-diff'] as const;

export function shadowDiffKey(ref: string) {
  return [...SHADOW_DIFF_KEY, ref] as const;
}

export const SHADOW_DIFF_EVENTS = ['git:status-changed'] as const satisfies ReadonlyArray<WsEvent['kind']>;

const SHADOW_DIFF: ReadonlySet<string> = new Set(SHADOW_DIFF_EVENTS);

/** The shadow-diff key prefix a WS event invalidates, or `null`. */
export function shadowDiffInvalidationFor(kind: WsEvent['kind']): readonly string[] | null {
  return SHADOW_DIFF.has(kind) ? SHADOW_DIFF_KEY : null;
}
