/**
 * 2.1.1 — a tagged list refreshes after an entity or tag change.
 *
 * `entity:changed` / `tag:changed` invalidate through the shell's 500 ms
 * batcher. The two tag-driven list views key their queries under their own
 * prefixes (`['tagged-list', type, tags, filter]`, `['tagged-list-mixed', …]`),
 * which no type list key is a prefix of — so the watcher queues these prefixes
 * explicitly. Pinned here: the prefixes reach the views' actual keys, and they
 * go through the batch window rather than invalidating at once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createInvalidationBatcher } from '../lib/wsBatcher.js';
import { TAGGED_LIST_QUERY_PREFIXES } from './useFileWatcher.js';

describe('tagged list views refresh on entity / tag changes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('[ac:ac-ws-query-keys-edytora-z-mapowania-enti] the queued prefixes invalidate both views after the 500 ms window', () => {
    const qc = new QueryClient();
    const tagged = ['tagged-list', 'dto', 'auth', 'or'];
    const mixed = ['tagged-list-mixed', 'auth', 'or', 'dto,endpoint'];
    qc.setQueryData(tagged, []);
    qc.setQueryData(mixed, []);

    const batcher = createInvalidationBatcher(qc, 500);
    for (const prefix of TAGGED_LIST_QUERY_PREFIXES) batcher.queue([...prefix]);

    vi.advanceTimersByTime(499);
    expect(qc.getQueryState(tagged)?.isInvalidated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(qc.getQueryState(tagged)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(mixed)?.isInvalidated).toBe(true);
  });
});
