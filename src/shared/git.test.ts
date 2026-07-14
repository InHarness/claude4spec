import { describe, expect, it } from 'vitest';
import { renderCommitTargetTemplate, localDateYYYYMMDD } from './git.js';

describe('renderCommitTargetTemplate (0.1.125)', () => {
  it('substitutes all three placeholders', () => {
    expect(
      renderCommitTargetTemplate('release/{release_slug}-{date}', { releaseName: 'My Release', date: '2026-07-14' }),
    ).toBe('release/my-release-2026-07-14');
  });

  it('{release_name} inserts the raw, unsanitized release name', () => {
    expect(renderCommitTargetTemplate('archive/{release_name}', { releaseName: 'My Release', date: '2026-07-14' })).toBe(
      'archive/My Release',
    );
  });

  it('does NOT re-match already-substituted text from an earlier placeholder (code review regression)', () => {
    // A release literally named "Sprint {date} Wrapup" — {release_name}
    // inserts this raw text, including its own literal "{date}" substring.
    // A naive sequential .replace() chain would let the LATER {date}
    // substitution re-match and rewrite that just-inserted text.
    const result = renderCommitTargetTemplate('release/{release_name}', {
      releaseName: 'Sprint {date} Wrapup',
      date: '2026-07-14',
    });
    expect(result).toBe('release/Sprint {date} Wrapup');
  });

  it('leaves unknown/unmatched text untouched', () => {
    expect(renderCommitTargetTemplate('static-name', { releaseName: 'X', date: '2026-07-14' })).toBe('static-name');
  });
});

describe('localDateYYYYMMDD (0.1.125)', () => {
  it('formats using LOCAL date components, not UTC (code review regression)', () => {
    // A local time that, in UTC, would already be the NEXT calendar day.
    const local = new Date(2026, 6, 14, 23, 30, 0); // July 14 2026, 23:30 local
    expect(localDateYYYYMMDD(local)).toBe('2026-07-14');
  });

  it('pads month/day to two digits', () => {
    expect(localDateYYYYMMDD(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
