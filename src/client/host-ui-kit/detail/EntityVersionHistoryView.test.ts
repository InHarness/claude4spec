import { describe, expect, it } from 'vitest';
import { resolveActiveVersion, resolveCompareVersion } from './EntityVersionHistoryView.js';

/** Versions come back newest-first, as `useVersions` returns them. */
const versions = (...nums: number[]) => nums.map((version) => ({ version }));

describe('resolveActiveVersion (M34)', () => {
  it('defaults to the newest version', () => {
    expect(resolveActiveVersion(versions(3, 2, 1), null)).toBe(3);
  });

  it('honours an explicit selection that exists', () => {
    expect(resolveActiveVersion(versions(3, 2, 1), 2)).toBe(2);
  });

  it('drops a selection carried over from another entity', () => {
    // Entity A was on v7; navigating to entity B reuses the same React instance.
    // Keeping 7 would fetch a version B does not have — a 404 per navigation.
    expect(resolveActiveVersion(versions(2, 1), 7)).toBe(2);
  });

  it('is null when the entity has no versions', () => {
    expect(resolveActiveVersion([], 3)).toBeNull();
  });
});

describe('resolveCompareVersion (M34)', () => {
  it('defaults to the version immediately older than the active one', () => {
    expect(resolveCompareVersion(versions(3, 2, 1), 3, null)).toBe(2);
  });

  it('is null for the oldest version — nothing to compare against', () => {
    expect(resolveCompareVersion(versions(3, 2, 1), 1, null)).toBeNull();
  });

  it('is null when the entity has exactly one version', () => {
    expect(resolveCompareVersion(versions(1), 1, null)).toBeNull();
  });

  it('honours an explicit compare target', () => {
    expect(resolveCompareVersion(versions(3, 2, 1), 3, 1)).toBe(1);
  });

  it('ignores a target equal to the active version', () => {
    expect(resolveCompareVersion(versions(3, 2, 1), 3, 3)).toBe(2);
  });

  it('ignores a target carried over from another entity', () => {
    expect(resolveCompareVersion(versions(2, 1), 2, 9)).toBe(1);
  });

  it('is null when nothing is active', () => {
    expect(resolveCompareVersion(versions(3, 2, 1), null, 2)).toBeNull();
  });
});
