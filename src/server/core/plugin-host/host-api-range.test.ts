import { describe, expect, it } from 'vitest';
import { satisfiesHostApi } from './host-api-range.js';

describe('satisfiesHostApi', () => {
  it('matches caret ranges within the same major', () => {
    expect(satisfiesHostApi('1.4.0', '^1.4.0')).toBe(true);
    expect(satisfiesHostApi('1.9.2', '^1.4.0')).toBe(true);
    expect(satisfiesHostApi('1.4.0', '^1.5.0')).toBe(false); // host below floor
    expect(satisfiesHostApi('2.0.0', '^1.4.0')).toBe(false); // next major excluded
  });

  it('matches tilde ranges within the same minor', () => {
    expect(satisfiesHostApi('1.4.7', '~1.4.0')).toBe(true);
    expect(satisfiesHostApi('1.5.0', '~1.4.0')).toBe(false);
  });

  it('matches exact, wildcard, and x-ranges', () => {
    expect(satisfiesHostApi('1.4.0', '1.4.0')).toBe(true);
    expect(satisfiesHostApi('1.4.1', '1.4.0')).toBe(false);
    expect(satisfiesHostApi('1.4.0', '*')).toBe(true);
    expect(satisfiesHostApi('1.4.0', '')).toBe(true);
    expect(satisfiesHostApi('1.4.0', '1.x')).toBe(true);
    expect(satisfiesHostApi('1.4.0', '1')).toBe(true);
    expect(satisfiesHostApi('2.0.0', '1.x')).toBe(false);
    expect(satisfiesHostApi('1.4.0', '1.5')).toBe(false);
  });

  it('matches comparators and OR clauses', () => {
    expect(satisfiesHostApi('1.4.0', '>=1.4.0')).toBe(true);
    expect(satisfiesHostApi('1.3.0', '>=1.4.0')).toBe(false);
    expect(satisfiesHostApi('1.4.0', '<2.0.0')).toBe(true);
    expect(satisfiesHostApi('1.4.0', '^0.9.0 || ^1.0.0')).toBe(true);
    expect(satisfiesHostApi('3.0.0', '^1.0.0 || ^2.0.0')).toBe(false);
  });

  it('is conservative on garbage input', () => {
    expect(satisfiesHostApi('not-a-version', '^1.0.0')).toBe(false);
    expect(satisfiesHostApi('1.4.0', 'garbage')).toBe(false);
  });
});
