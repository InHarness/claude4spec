import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateAfterVersionRestore, versionDiffQueryKey } from './useVersions.js';

describe('invalidateAfterVersionRestore', () => {
  it('invalidates the versions list, tags, AND the entity\'s own per-type detail key', () => {
    const qc = new QueryClient();
    qc.setQueryData(['versions', 'dto', 'my-dto'], []);
    qc.setQueryData(['tags'], []);
    qc.setQueryData(['dto', 'my-dto'], { slug: 'my-dto', name: 'stale' });

    invalidateAfterVersionRestore(qc, 'dto', 'my-dto');

    expect(qc.getQueryState(['versions', 'dto', 'my-dto'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['tags'])?.isInvalidated).toBe(true);
    // The regression: an open useDto('my-dto') view reads THIS key — without
    // invalidating it, the panel keeps showing pre-restore data after a
    // successful restore.
    expect(qc.getQueryState(['dto', 'my-dto'])?.isInvalidated).toBe(true);
  });

  it('does not touch a different entity\'s cached detail query', () => {
    const qc = new QueryClient();
    qc.setQueryData(['dto', 'other-dto'], { slug: 'other-dto' });

    invalidateAfterVersionRestore(qc, 'dto', 'my-dto');

    expect(qc.getQueryState(['dto', 'other-dto'])?.isInvalidated).toBeFalsy();
  });
});

describe('versionDiffQueryKey', () => {
  it('builds a stable key when type/slug/fromId/toId are all present', () => {
    expect(versionDiffQueryKey('dto', 'my-dto', 1, 2)).toEqual(['version-diff', 'dto', 'my-dto', 1, 2]);
  });

  it('falls back to a per-type "none" sentinel when slug is null', () => {
    expect(versionDiffQueryKey('dto', null, 1, 2)).toEqual(['version-diff', 'dto', 'none']);
  });

  it('falls back to the sentinel when fromId is null', () => {
    expect(versionDiffQueryKey('dto', 'my-dto', null, 2)).toEqual(['version-diff', 'dto', 'none']);
  });

  it('falls back to the sentinel when toId is null', () => {
    expect(versionDiffQueryKey('dto', 'my-dto', 1, null)).toEqual(['version-diff', 'dto', 'none']);
  });

  it('does not collide across different (type, slug) pairs', () => {
    expect(versionDiffQueryKey('dto', 'a', 1, 2)).not.toEqual(versionDiffQueryKey('dto', 'b', 1, 2));
    expect(versionDiffQueryKey('dto', 'a', 1, 2)).not.toEqual(versionDiffQueryKey('endpoint', 'a', 1, 2));
  });
});
