import { describe, expect, it } from 'vitest';
import matter from 'gray-matter';
import { hashContent, toIso } from './artifact-content.js';

describe('toIso', () => {
  it('normalizes a gray-matter-parsed Date (unquoted YAML timestamp) to ISO 8601', () => {
    // Regression: gray-matter/js-yaml auto-parses an unquoted ISO-8601 scalar
    // into a native JS Date — String(date) produces the verbose
    // `Date.prototype.toString()` form ("Wed Jul 15 2026..."), not ISO-8601,
    // which also sorts wrong lexicographically against real ISO strings.
    const parsed = matter('---\ncreated_at: 2026-07-15T10:23:45.678Z\n---\nbody');
    expect(parsed.data.created_at).toBeInstanceOf(Date);
    expect(toIso(parsed.data.created_at)).toBe('2026-07-15T10:23:45.678Z');
  });

  it('passes through an already-string (quoted YAML) value unchanged', () => {
    const parsed = matter('---\ncreated_at: "2026-07-15T10:23:45.678Z"\n---\nbody');
    expect(typeof parsed.data.created_at).toBe('string');
    expect(toIso(parsed.data.created_at)).toBe('2026-07-15T10:23:45.678Z');
  });

  it('returns empty string for null/undefined', () => {
    expect(toIso(undefined)).toBe('');
    expect(toIso(null)).toBe('');
  });
});

describe('hashContent', () => {
  it('is deterministic and sensitive to content changes', () => {
    expect(hashContent('a')).toBe(hashContent('a'));
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});
