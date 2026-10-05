import { describe, expect, it } from 'vitest';
import { attributeDropped, composeSectionBatch, type BatchElement } from './section-batch.js';

/**
 * 2.1.7 — the shared section-batch engine (M43 "section batch rules"), tested
 * where it is pure: lines in, lines out. The page and plan write paths wrap it
 * with their own guards (`page-write.test.ts`, `plan-write.test.ts`).
 */

const PAGE = [
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
  '<!-- anchor: aaaa0003 -->',
  '### Alpha second',
  '',
  'second body',
  '',
  '<!-- anchor: bbbb0001 -->',
  '## Beta',
  '',
  'beta body',
].join('\n');

const LEAF = ['<!-- anchor: cccc0001 -->', '## Leaf', '', 'leaf body', ''].join('\n');

const run = (body: string, elements: BatchElement[]) => composeSectionBatch(body.split('\n'), elements);
const text = (body: string, elements: BatchElement[]) => run(body, elements).lines.join('\n');

function refusal(body: string, elements: BatchElement[]): { code: string; message: string; hint?: string } {
  try {
    run(body, elements);
  } catch (e) {
    return e as { code: string; message: string; hint?: string };
  }
  throw new Error('expected a refusal');
}

describe('replace acts on the OWN body', () => {
  it('keeps the heading and the subsections with their anchors', () => {
    const out = text(PAGE, [{ anchor: 'aaaa0001', action: 'replace', content: '\nnew alpha\n' }]);
    expect(out).toContain('## Alpha\n\nnew alpha\n\n<!-- anchor: aaaa0002 -->\n### Alpha child');
    expect(out).toContain('<!-- anchor: aaaa0003 -->');
    expect(out).not.toContain('alpha body');
  });

  it('refuses a heading at or above the section level in content', () => {
    const r = refusal(PAGE, [{ anchor: 'aaaa0001', action: 'replace', content: '## Sibling' }]);
    expect(r.code).toBe('INVALID_ARGUMENT');
    expect(r.message).toMatch(/replace for 'aaaa0001' carries a level-2 heading/);
  });

  it('a deeper heading becomes the first child, before the existing ones', () => {
    const out = text(PAGE, [{ anchor: 'aaaa0001', action: 'replace', content: 'intro\n\n### New first' }]);
    expect(out.indexOf('### New first')).toBeLessThan(out.indexOf('### Alpha child'));
  });

  it('a heading inside a code block of content is code', () => {
    expect(() => run(PAGE, [{ anchor: 'aaaa0001', action: 'replace', content: '```\n## not a heading\n```' }])).not.toThrow();
  });

  it('reports no scope — it cannot drop an anchor', () => {
    expect(run(PAGE, [{ anchor: 'aaaa0001', action: 'replace', content: 'x' }]).outcomes[0]!.scope).toEqual([]);
  });
});

describe('several actions on one anchor', () => {
  it('rename + replace rewrites the whole section in one batch', () => {
    const out = text(PAGE, [
      { anchor: 'aaaa0001', action: 'replace', content: '\nrewritten\n' },
      { anchor: 'aaaa0001', action: 'rename', heading: 'Alpha, renamed' },
    ]);
    expect(out).toContain('<!-- anchor: aaaa0001 -->\n## Alpha, renamed\n\nrewritten\n\n<!-- anchor: aaaa0002 -->');
  });

  it('rename + replace + insert_after on one anchor', () => {
    const out = text(LEAF, [
      { anchor: 'cccc0001', action: 'rename', heading: 'Leaf 2' },
      { anchor: 'cccc0001', action: 'replace', content: 'new' },
      { anchor: 'cccc0001', action: 'insert_after', content: '## After' },
    ]);
    expect(out).toBe(['<!-- anchor: cccc0001 -->', '## Leaf 2', 'new', '## After'].join('\n'));
  });

  it('rename + append and rename + insert_after', () => {
    expect(() =>
      run(PAGE, [
        { anchor: 'aaaa0001', action: 'rename', heading: 'A' },
        { anchor: 'aaaa0001', action: 'append', content: 'more' },
        { anchor: 'aaaa0001', action: 'insert_after', content: 'after' },
      ]),
    ).not.toThrow();
  });

  it('edit + insert_after on the same anchor', () => {
    const out = text(LEAF, [
      { anchor: 'cccc0001', action: 'edit', textEdits: [{ find: 'leaf body', replaceWith: 'leaf text' }] },
      { anchor: 'cccc0001', action: 'insert_after', content: 'tail' },
    ]);
    expect(out).toBe(['<!-- anchor: cccc0001 -->', '## Leaf', '', 'leaf text', '', 'tail'].join('\n'));
  });

  it('edit + rename on one anchor is order-independent when no match touches the head', () => {
    const edit: BatchElement = { anchor: 'cccc0001', action: 'edit', textEdits: [{ find: 'body', replaceWith: 'text' }] };
    const rename: BatchElement = { anchor: 'cccc0001', action: 'rename', heading: 'Renamed' };
    expect(text(LEAF, [edit, rename])).toBe(text(LEAF, [rename, edit]));
    const outcomes = run(LEAF, [edit, rename]).outcomes;
    expect(outcomes[1]!.previousHeading).toBe('Leaf');
  });

  it('replace on an ancestor and rename on a descendant', () => {
    const out = text(PAGE, [
      { anchor: 'aaaa0001', action: 'replace', content: 'new intro' },
      { anchor: 'aaaa0002', action: 'rename', heading: 'Child renamed' },
    ]);
    expect(out).toContain('## Alpha\nnew intro\n<!-- anchor: aaaa0002 -->\n### Child renamed');
  });

  it('replace on a parent next to edits in its subsections', () => {
    const out = text(PAGE, [
      { anchor: 'aaaa0001', action: 'replace', content: 'new intro' },
      { anchor: 'aaaa0002', action: 'edit', textEdits: [{ find: 'child body', replaceWith: 'child text' }] },
    ]);
    expect(out).toContain('new intro');
    expect(out).toContain('child text');
  });
});

describe('refusals (INVALID_ARGUMENT, both elements named, repair given)', () => {
  it('two elements of the same action on one anchor, even with disjoint matches', () => {
    const r = refusal(LEAF, [
      { anchor: 'cccc0001', action: 'edit', textEdits: [{ find: 'leaf', replaceWith: 'x' }] },
      { anchor: 'cccc0001', action: 'edit', textEdits: [{ find: 'body', replaceWith: 'y' }] },
    ]);
    expect(r.code).toBe('INVALID_ARGUMENT');
    expect(r.message).toMatch(/edits\[0\] \(anchor 'cccc0001', edit\) and edits\[1\] \(anchor 'cccc0001', edit\)/);
    expect(r.hint).toMatch(/merge the two `textEdits`/);
  });

  it('an edit match touching the head of a section renamed in the batch', () => {
    const r = refusal(LEAF, [
      { anchor: 'cccc0001', action: 'edit', textEdits: [{ find: '## Leaf', replaceWith: '## Leaf!' }] },
      { anchor: 'cccc0001', action: 'rename', heading: 'Other' },
    ]);
    expect(r.code).toBe('INVALID_ARGUMENT');
    expect(r.message).toMatch(/edits\[0\].*collides with edits\[1\]/);
    expect(r.hint).toMatch(/leave the heading change to rename/);
  });

  it('an edit on an ancestor touching the head of a renamed descendant', () => {
    const r = refusal(PAGE, [
      { anchor: 'aaaa0001', action: 'edit', textEdits: [{ find: '### Alpha child', replaceWith: '### X' }] },
      { anchor: 'aaaa0002', action: 'rename', heading: 'Y' },
    ]);
    expect(r.code).toBe('INVALID_ARGUMENT');
  });

  it('an edit match inside the own body of a replaced section', () => {
    const r = refusal(PAGE, [
      { anchor: 'aaaa0001', action: 'edit', textEdits: [{ find: 'alpha body', replaceWith: 'x' }] },
      { anchor: 'aaaa0001', action: 'replace', content: 'new' },
    ]);
    expect(r.hint).toMatch(/write the change into that replace's `content`/);
  });

  it('an edit match strictly containing the append point of the same section', () => {
    const r = refusal(PAGE, [
      { anchor: 'aaaa0001', action: 'edit', textEdits: [{ find: 'alpha body\n\n<!-- anchor: aaaa0002 -->', replaceWith: 'x\n\n<!-- anchor: aaaa0002 -->' }] },
      { anchor: 'aaaa0001', action: 'append', content: 'more' },
    ]);
    expect(r.hint).toMatch(/narrow the `find`/);
  });

  it('insert_after whose point lies inside an ancestor edit match', () => {
    const r = refusal(PAGE, [
      { anchor: 'aaaa0001', action: 'edit', textEdits: [{ find: 'child body\n\n<!-- anchor: aaaa0003 -->', replaceWith: 'x\n\n<!-- anchor: aaaa0003 -->' }] },
      { anchor: 'aaaa0002', action: 'insert_after', content: 'more' },
    ]);
    expect(r.code).toBe('INVALID_ARGUMENT');
  });

  it('edit on a ### in a batch deleting its ## parent', () => {
    const r = refusal(PAGE, [
      { anchor: 'aaaa0001', action: 'delete' },
      { anchor: 'aaaa0002', action: 'edit', textEdits: [{ find: 'child body', replaceWith: 'x' }] },
    ]);
    expect(r.message).toMatch(/edits\[1\] \(anchor 'aaaa0002', edit\) addresses an anchor inside the subtree edits\[0\]/);
    expect(r.hint).toMatch(/insert_after on the previous section/);
  });

  it('insert_after on the last child of a deleted section — even though its point is on the edge', () => {
    expect(refusal(PAGE, [
      { anchor: 'aaaa0003', action: 'insert_after', content: 'x' },
      { anchor: 'aaaa0001', action: 'delete' },
    ]).code).toBe('INVALID_ARGUMENT');
  });

  it('rename under a deleted ancestor', () => {
    expect(refusal(PAGE, [
      { anchor: 'aaaa0001', action: 'delete' },
      { anchor: 'aaaa0002', action: 'rename', heading: 'x' },
    ]).code).toBe('INVALID_ARGUMENT');
  });

  it('overlapping edit matches across two anchors', () => {
    const r = refusal(PAGE, [
      { anchor: 'aaaa0001', action: 'edit', textEdits: [{ find: 'child body', replaceWith: 'x' }] },
      { anchor: 'aaaa0002', action: 'edit', textEdits: [{ find: 'body', replaceWith: 'y' }] },
    ]);
    expect(r.hint).toMatch(/combine them into one match/);
  });
});

describe('insertion-order', () => {
  it('replace + append on one anchor: the append lands after the new body', () => {
    const out = text(LEAF, [
      { anchor: 'cccc0001', action: 'append', content: 'appended' },
      { anchor: 'cccc0001', action: 'replace', content: 'new body' },
    ]);
    expect(out).toBe(['<!-- anchor: cccc0001 -->', '## Leaf', 'new body', 'appended'].join('\n'));
  });

  it('append before insert_after on a leaf, whatever the input order', () => {
    const out = text(LEAF, [
      { anchor: 'cccc0001', action: 'insert_after', content: 'inserted' },
      { anchor: 'cccc0001', action: 'append', content: 'appended' },
    ]);
    expect(out.indexOf('appended')).toBeLessThan(out.indexOf('inserted'));
  });

  it("a descendant's insert_after before its ancestor's", () => {
    const out = text(PAGE, [
      { anchor: 'aaaa0001', action: 'insert_after', content: 'after parent' },
      { anchor: 'aaaa0003', action: 'insert_after', content: 'after last child' },
    ]);
    expect(out.indexOf('after last child')).toBeLessThan(out.indexOf('after parent'));
    expect(out.indexOf('after parent')).toBeLessThan(out.indexOf('## Beta'));
  });

  it('an edit match ending at the append point: the append stands after the replaced text', () => {
    const out = text(LEAF, [
      { anchor: 'cccc0001', action: 'edit', textEdits: [{ find: 'leaf body\n', replaceWith: 'leaf text\n' }] },
      { anchor: 'cccc0001', action: 'append', content: 'appended' },
    ]);
    expect(out.indexOf('leaf text')).toBeLessThan(out.indexOf('appended'));
  });

  it('a delete of a first child next to an append on the parent keeps the appended text', () => {
    const out = text(PAGE, [
      { anchor: 'aaaa0002', action: 'delete' },
      { anchor: 'aaaa0001', action: 'append', content: 'appended' },
    ]);
    expect(out).toContain('appended\n<!-- anchor: aaaa0003 -->');
    expect(out).not.toContain('aaaa0002');
  });
});

describe('outcomes per element', () => {
  it('delete scopes its whole subtree; insert_after declares its subtree; edit only its matches', () => {
    const r = run(PAGE, [{ anchor: 'aaaa0001', action: 'delete' }]);
    expect(r.outcomes[0]!.scope).toEqual(['aaaa0001', 'aaaa0002', 'aaaa0003']);
    const i = run(PAGE, [{ anchor: 'aaaa0001', action: 'insert_after', content: 'x' }]);
    expect(i.outcomes[0]!.scope).toEqual(['aaaa0001', 'aaaa0002', 'aaaa0003']);
    const e = run(PAGE, [{ anchor: 'aaaa0001', action: 'edit', textEdits: [{ find: 'alpha body', replaceWith: 'x' }] }]);
    expect(e.outcomes[0]!.scope).toEqual([]);
    expect(e.outcomes[0]!.replacements).toBe(1);
  });

  it('a replace whose content carries a subsection anchor brings that value in', () => {
    const r = run(PAGE, [{ anchor: 'aaaa0001', action: 'replace', content: 'x\n\n<!-- anchor: aaaa0002 -->\n### Copy' }]);
    expect(r.outcomes[0]!.broughtIn).toEqual(['aaaa0002']);
    expect(r.outcomes[0]!.takenOut).toEqual([]);
  });
});

describe('attributeDropped — a dropped anchor goes to the element that carried it out', () => {
  it('a deleted child is reported on the delete row, not on an insert_after listed first', () => {
    const composed = run(PAGE, [
      { anchor: 'aaaa0001', action: 'insert_after', content: 'after alpha' },
      { anchor: 'aaaa0002', action: 'delete' },
    ]);
    const finalAnchors = new Set(['aaaa0001', 'aaaa0003', 'bbbb0001']);
    expect(attributeDropped(composed.outcomes, (a) => finalAnchors.has(a))).toEqual([[], ['aaaa0002']]);
  });
});

describe('attributeDropped — anchors swallowed outside every scope', () => {
  it('an unclosed fence in a replace is reported on that replace row, never on a rename below it', () => {
    const composed = run(PAGE, [
      { anchor: 'bbbb0001', action: 'rename', heading: 'Beta renamed' },
      { anchor: 'aaaa0001', action: 'replace', content: '```\nopen' },
    ]);
    const prior = new Map([
      ['aaaa0001', 1],
      ['aaaa0002', 6],
      ['aaaa0003', 11],
      ['bbbb0001', 16],
    ]);
    const survivors = new Set(['aaaa0001']);
    expect(attributeDropped(composed.outcomes, (a) => survivors.has(a), prior)).toEqual([
      [],
      ['aaaa0002', 'aaaa0003', 'bbbb0001'],
    ]);
  });
});
