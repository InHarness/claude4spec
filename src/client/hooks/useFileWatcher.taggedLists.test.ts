/**
 * 2.1.1 — a tagged list refreshes after an entity or tag change.
 *
 * `entity:changed` / `entity:indexed` / `tag:changed` all queue `['entities']`
 * through the shell's 500 ms batcher. The two tag-driven list views key their
 * queries under that prefix (`['entities', 'tagged-list', …]`,
 * `['entities', 'tagged-list-mixed', …]`), so that one invalidation reaches
 * them — no view-specific key in the watcher. Pinned here: the prefix reaches
 * the views' actual keys, and only once the batch window closes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createInvalidationBatcher } from '../lib/wsBatcher.js';

describe('tagged list views refresh on entity / tag changes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('[ac:ac-ws-query-keys-edytora-z-mapowania-enti] the entities prefix invalidates both views after the 500 ms window', () => {
    const qc = new QueryClient();
    const tagged = ['entities', 'tagged-list', 'dto', ['auth'], 'or'];
    const mixed = ['entities', 'tagged-list-mixed', ['auth'], 'or', 'dto,endpoint'];
    qc.setQueryData(tagged, []);
    qc.setQueryData(mixed, []);

    const batcher = createInvalidationBatcher(qc, 500);
    batcher.queue(['entities']);

    vi.advanceTimersByTime(499);
    expect(qc.getQueryState(tagged)?.isInvalidated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(qc.getQueryState(tagged)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(mixed)?.isInvalidated).toBe(true);
  });
});
