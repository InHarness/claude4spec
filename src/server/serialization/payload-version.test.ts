import { describe, expect, it } from 'vitest';
import { payloadVersionOfCapture, samePayloadVersion } from './payload-version.js';

describe('payloadVersionOfCapture', () => {
  it('reads an integer capture as itself and a semver capture as payload 1', () => {
    expect(payloadVersionOfCapture('1')).toBe(1);
    expect(payloadVersionOfCapture('2')).toBe(2);
    // Pre-0.2.9 spellings. A semver in this column is, by its shape, a capture
    // from before the column changed vocabulary — and every type was payload 1.
    expect(payloadVersionOfCapture('1.0.0')).toBe(1);
    expect(payloadVersionOfCapture('1.1.0')).toBe(1);
    expect(payloadVersionOfCapture('unknown')).toBe(1);
    expect(payloadVersionOfCapture(null)).toBe(1);
  });
});

describe('samePayloadVersion', () => {
  it('does NOT flag a pair that spans the 0.2.9 vocabulary change', () => {
    // The regression this exists for: without it, every entity in every diff
    // crossing the upgrade wore the amber "schema bump" badge, reporting a
    // serializer migration that never happened.
    expect(samePayloadVersion('1.1.0', '1')).toBe(true);
    expect(samePayloadVersion('1', '1.0.0')).toBe(true);
  });

  it('still flags a genuine historical bump between two pre-0.2.9 captures', () => {
    // Collapsing both onto 1 would have silently retired the signal for every
    // row already in the database.
    expect(samePayloadVersion('1.0.0', '1.1.0')).toBe(false);
    expect(samePayloadVersion('1.1.0', '1.1.0')).toBe(true);
  });

  it('compares two post-0.2.9 captures as payload versions', () => {
    expect(samePayloadVersion('1', '2')).toBe(false);
    expect(samePayloadVersion('2', '2')).toBe(true);
  });

  it('treats an absent version as the integer vocabulary, not as a legacy semver', () => {
    expect(samePayloadVersion(null, '1')).toBe(true);
    expect(samePayloadVersion(null, '2')).toBe(false);
  });
});
