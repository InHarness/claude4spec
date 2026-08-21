import { describe, expect, it } from 'vitest';
import { applyPlanBatch, selectPlanVariant, type PlanSectionEdit } from './plan-write.js';

/**
 * 0.2.43 — the plan's edit grammar, tested where it is pure.
 *
 * Everything here runs on a string. The filesystem half (hash guard, one
 * `file_version` row per call, `plan:updated`) is exercised in
 * `tests/integration/db/plans.test.ts` against a real service.
 */

const PLAN = [
  '<!-- anchor: aaaa0001 -->',
  '## Alpha',
  '',
  'alpha body',
  '',
  '<!-- anchor: aaaa0002 -->',
  '### Alpha child',
  '',
  'child body',
  '',
  '<!-- anchor: bbbb0001 -->',
  '## Beta',
  '',
  'beta body',
  '',
].join('\n');

const anchorsOf = (body: string) => [...body.matchAll(/<!-- anchor: ([a-z0-9]{8}) -->/g)].map((m) => m[1]);

describe('selectPlanVariant — exactly one of three', () => {
  it('refuses a call with no variant at all', () => {
    expect(() => selectPlanVariant({})).toThrow(/exactly one/);
    try {
      selectPlanVariant({});
      expect.unreachable('should have refused');
    } catch (e) {
      expect((e as { code: string }).code).toBe('INVALID_ARGUMENT');
    }
  });

  it('refuses a call carrying two variants, and names both', () => {
    expect(() => selectPlanVariant({ content: 'x', textEdits: [{ find: 'a', replaceWith: 'b' }] })).toThrow(
      /content and textEdits/,
    );
  });

  it('accepts an empty string as the content variant — "present" is not "truthy"', () => {
    expect(selectPlanVariant({ content: '' })).toEqual({ variant: 'content', content: '' });
  });

  it('refuses an empty batch', () => {
    expect(() => selectPlanVariant({ edits: [] })).toThrow(/non-empty/);
  });

  it('refuses the same anchor twice in one batch rather than folding the two', () => {
    expect(() =>
      selectPlanVariant({
        edits: [
          { anchor: 'aaaa0001', action: 'replace', content: 'one' },
          { anchor: 'aaaa0001', action: 'append', content: 'two' },
        ],
      }),
    ).toThrow(/appears more than once/);
  });

  it.each([
    ['content on an edit', { anchor: 'a', action: 'edit', content: 'x' }, /takes textEdits, not content/],
    ['an edit with no textEdits', { anchor: 'a', action: 'edit' }, /requires a non-empty textEdits/],
    [
      'textEdits on a replace',
      { anchor: 'a', action: 'replace', content: 'x', textEdits: [{ find: 'a', replaceWith: 'b' }] },
      /only action 'edit' accepts/,
    ],
    ['content on a delete', { anchor: 'a', action: 'delete', content: 'x' }, /action 'delete' does not take/],
    ['a replace with no content', { anchor: 'a', action: 'replace' }, /requires content/],
    ['an unknown action', { anchor: 'a', action: 'insert_after_section' }, /unknown action/],
  ])('refuses %s', (_name, edit, message) => {
    expect(() => selectPlanVariant({ edits: [edit as PlanSectionEdit] })).toThrow(message);
  });
});

describe('applyPlanBatch — anchor resolution', () => {
  it('refuses an anchor the plan does not carry, with no append-at-end fallback', () => {
    expect(() => applyPlanBatch(PLAN, [{ anchor: 'zzzz9999', action: 'append', content: 'x' }])).toThrow(
      /not found in this plan/,
    );
  });

  it('refuses an anchor the plan carries twice — the ambiguity is not resolved in the caller’s favour', () => {
    const dup = PLAN + '\n<!-- anchor: aaaa0001 -->\n## Alpha again\n\nmore\n';
    let code = '';
    try {
      applyPlanBatch(dup, [{ anchor: 'aaaa0001', action: 'append', content: 'x' }]);
    } catch (e) {
      code = (e as { code: string }).code;
    }
    expect(code).toBe('AMBIGUOUS_ANCHOR');
  });
});

describe('applyPlanBatch — a section is its subtree', () => {
  it('replace on a parent rewrites its children too, and reports them as dropped', () => {
    const out = applyPlanBatch(PLAN, [{ anchor: 'aaaa0001', action: 'replace', content: 'new alpha' }]);
    expect(out.body).toContain('new alpha');
    expect(out.body).not.toContain('child body');
    // The parent's own heading and anchor survive a replace; the child's do not.
    expect(anchorsOf(out.body)).toEqual(['aaaa0001', 'bbbb0001']);
    expect(out.scopeOf.get('aaaa0001')).toEqual(['aaaa0002']);
  });

  it('delete takes the heading, the anchor comment and the whole subtree', () => {
    const out = applyPlanBatch(PLAN, [{ anchor: 'aaaa0001', action: 'delete' }]);
    expect(out.body).not.toContain('## Alpha');
    expect(out.body).not.toContain('### Alpha child');
    expect(anchorsOf(out.body)).toEqual(['bbbb0001']);
    expect(out.scopeOf.get('aaaa0001')).toEqual(['aaaa0001', 'aaaa0002']);
  });

  it('append lands at the end of the section’s OWN text, before its first child', () => {
    const out = applyPlanBatch(PLAN, [{ anchor: 'aaaa0001', action: 'append', content: 'appended' }]);
    expect(out.body.indexOf('appended')).toBeLessThan(out.body.indexOf('### Alpha child'));
  });

  it('insert_after lands after the whole subtree, past the children', () => {
    const out = applyPlanBatch(PLAN, [{ anchor: 'aaaa0001', action: 'insert_after', content: 'inserted' }]);
    expect(out.body.indexOf('inserted')).toBeGreaterThan(out.body.indexOf('child body'));
    expect(out.body.indexOf('inserted')).toBeLessThan(out.body.indexOf('## Beta'));
  });
});

describe('applyPlanBatch — a batch is a set, not a sequence', () => {
  const batch: PlanSectionEdit[] = [
    { anchor: 'aaaa0001', action: 'append', content: 'to alpha' },
    { anchor: 'bbbb0001', action: 'append', content: 'to beta' },
    { anchor: 'aaaa0002', action: 'replace', content: 'new child' },
  ];

  it('produces identical text whatever order the entries arrive in', () => {
    const forward = applyPlanBatch(PLAN, batch).body;
    const reversed = applyPlanBatch(PLAN, [...batch].reverse()).body;
    const shuffled = applyPlanBatch(PLAN, [batch[2]!, batch[0]!, batch[1]!]).body;
    expect(reversed).toBe(forward);
    expect(shuffled).toBe(forward);
  });

  it('applies every entry — bottom-up ordering is not a way of dropping one', () => {
    const out = applyPlanBatch(PLAN, batch).body;
    expect(out).toContain('to alpha');
    expect(out).toContain('to beta');
    expect(out).toContain('new child');
  });
});

describe('applyPlanBatch — the edit action', () => {
  it('substitutes inside the addressed subtree and counts what it did', () => {
    const out = applyPlanBatch(PLAN, [
      { anchor: 'aaaa0001', action: 'edit', textEdits: [{ find: 'alpha body', replaceWith: 'ALPHA BODY' }] },
    ]);
    expect(out.body).toContain('ALPHA BODY');
    expect(out.replacementsOf.get('aaaa0001')).toBe(1);
  });

  it('counts matches in the SUBTREE only — the trap the top-level variant does not have', () => {
    // 'body' appears three times in the plan and twice inside Alpha's subtree,
    // so the same declaration means different things in the two variants.
    expect(() =>
      applyPlanBatch(PLAN, [
        { anchor: 'aaaa0001', action: 'edit', textEdits: [{ find: 'body', replaceWith: 'text', expectedMatches: 3 }] },
      ]),
    ).toThrow(/matched 2 time/);
    const out = applyPlanBatch(PLAN, [
      { anchor: 'aaaa0001', action: 'edit', textEdits: [{ find: 'body', replaceWith: 'text', expectedMatches: 2 }] },
    ]);
    expect(out.replacementsOf.get('aaaa0001')).toBe(2);
    // Beta's body is outside the subtree and untouched.
    expect(out.body).toContain('beta body');
  });

  it('answers FIND_NOT_FOUND with the whitespace-normalization diagnosis', () => {
    try {
      applyPlanBatch(PLAN, [
        { anchor: 'aaaa0001', action: 'edit', textEdits: [{ find: 'alpha    body', replaceWith: 'x' }] },
      ]);
      expect.unreachable('should have refused');
    } catch (e) {
      const err = e as { code: string; details: Array<{ matchesAfterWhitespaceNormalization: number }> };
      expect(err.code).toBe('FIND_NOT_FOUND');
      expect(err.details[0]!.matchesAfterWhitespaceNormalization).toBe(1);
    }
  });

  it('refuses an edit nested inside a section the same batch replaces', () => {
    expect(() =>
      applyPlanBatch(PLAN, [
        { anchor: 'aaaa0001', action: 'replace', content: 'new alpha' },
        { anchor: 'aaaa0002', action: 'edit', textEdits: [{ find: 'child body', replaceWith: 'x' }] },
      ]),
    ).toThrow(/lies inside/);
  });

  it('refuses an edit that encloses a section the same batch deletes', () => {
    expect(() =>
      applyPlanBatch(PLAN, [
        { anchor: 'aaaa0002', action: 'delete' },
        { anchor: 'aaaa0001', action: 'edit', textEdits: [{ find: 'alpha body', replaceWith: 'x' }] },
      ]),
    ).toThrow(/encloses/);
  });

  it('refuses an edit that encloses a section the same batch APPENDS to', () => {
    // Not only `replace`/`delete`: the child splices first either way, so the
    // parent's `find` would be matched against text this same batch wrote.
    expect(() =>
      applyPlanBatch(PLAN, [
        { anchor: 'aaaa0002', action: 'append', content: 'brand new body line' },
        { anchor: 'aaaa0001', action: 'edit', textEdits: [{ find: 'body', replaceWith: 'text', expectedMatches: 'all' }] },
      ]),
    ).toThrow(/encloses/);
  });

  it('refuses an edit nested inside a section the same batch inserts after', () => {
    expect(() =>
      applyPlanBatch(PLAN, [
        { anchor: 'aaaa0001', action: 'insert_after', content: 'tail' },
        { anchor: 'aaaa0002', action: 'edit', textEdits: [{ find: 'child body', replaceWith: 'x' }] },
      ]),
    ).toThrow(/lies inside/);
  });

  it('scopes an edit to its MATCHED fragments, not to the subtree it was aimed at', () => {
    // The substitution lands in Alpha's own prose, nowhere near the child's
    // anchor comment — so it puts no anchor at risk.
    const out = applyPlanBatch(PLAN, [
      { anchor: 'aaaa0001', action: 'edit', textEdits: [{ find: 'alpha body', replaceWith: 'x' }] },
    ]);
    expect(out.scopeOf.get('aaaa0001')).toEqual([]);
  });
});

describe('applyPlanBatch — delete takes the anchor comment however it is spaced', () => {
  it('removes a comment separated from its heading by a blank line', () => {
    // `parseHeadings` resolves an anchor across blank lines, so a delete that
    // only looked at the line directly above would leave the comment behind —
    // and every deep link to the removed section would keep resolving.
    const spaced = PLAN.replace('<!-- anchor: aaaa0001 -->\n## Alpha', '<!-- anchor: aaaa0001 -->\n\n## Alpha');
    const out = applyPlanBatch(spaced, [{ anchor: 'aaaa0001', action: 'delete' }]);
    expect(out.body).not.toContain('aaaa0001');
    expect(anchorsOf(out.body)).toEqual(['bbbb0001']);
  });
});
