import { describe, expect, it } from 'vitest';
import { FileSerializer, computeLineDiff } from './file-serializer.js';
import type { PagesService } from './pages.js';

const ser = new FileSerializer({ root: '/nowhere', rootId: 'pages' } as unknown as PagesService);
const snap = (content: string) => ser.snapshotFromContent('p.md', content);
const diff = (a: string, b: string) => ser.diff(snap(a), snap(b), 'p.md');
const A = (id: string) => `<!-- anchor: ${id} -->`;

const base = [
  '---',
  'title: T',
  '---',
  'intro',
  '',
  A('parent01'),
  '## Parent',
  'own',
  '',
  A('child001'),
  '### Child',
  'child text',
  '',
  A('sibling1'),
  '## Sibling',
  'sib',
  '',
].join('\n');

describe('FileSerializer.diff — on the shared section parser (2.0.0)', () => {
  it('a change inside a subsection yields the subsection entry only, never the parent', () => {
    const d = diff(base, base.replace('child text', 'child text CHANGED'));
    expect(d.modified_sections.map((s) => s.anchor)).toEqual(['child001']);
    expect(d.modified_sections[0]).toMatchObject({ kind: 'section', heading: 'Child', level: 3, parent: 'parent01' });
    expect(d.rootId).toBe('pages');
  });

  it('content/line_diff cover the OWN body only', () => {
    const d = diff(base, base.replace('own', 'own CHANGED'));
    const lines = d.modified_sections[0]!.line_diff.lines;
    expect(d.modified_sections.map((s) => s.anchor)).toEqual(['parent01']);
    expect(lines.some((l) => l.content.includes('child text'))).toBe(false);
  });

  it('a heading text change alone is a modified entry', () => {
    const d = diff(base, base.replace('## Sibling', '## Renamed'));
    expect(d.modified_sections).toEqual([
      expect.objectContaining({ anchor: 'sibling1', heading: 'Renamed' }),
    ]);
  });

  it('the parent gets no entry when only another heading changes level', () => {
    const d = diff(base, base.replace('### Child', '## Child'));
    expect(d.modified_sections.map((s) => s.anchor)).toEqual(['child001']);
  });

  it('the preamble is a full element keyed ~preamble; a page without headings diffs as a preamble', () => {
    const d = diff(base, base.replace('intro', 'intro CHANGED'));
    expect(d.modified_sections).toEqual([
      expect.objectContaining({ kind: 'preamble', anchor: '~preamble', heading: null, level: null, parent: null }),
    ]);
    const flat = ser.diff(snap('only text'), snap('other text'), 'p.md');
    expect(flat.modified_sections.map((s) => s.kind)).toEqual(['preamble']);
    const created = ser.diff(null, snap('x\n## H\ny'), 'p.md');
    expect(created.added_sections.map((s) => s.kind)).toEqual(['preamble', 'section']);
  });

  it('a heading without an anchor never pairs: removed + added, identified by heading', () => {
    const a = '## Loose\nold\n';
    const d = ser.diff(snap(a), snap('## Loose\nnew\n'), 'p.md');
    expect(d.modified_sections).toEqual([]);
    expect(d.removed_sections).toEqual([expect.objectContaining({ anchor: null, heading: 'Loose', content: 'old\n' })]);
    expect(d.added_sections).toEqual([expect.objectContaining({ anchor: null, heading: 'Loose', content: 'new\n' })]);
    expect(ser.diff(snap(a), snap(a + '\nextra preamble? no'), 'p.md').moved_sections).toEqual([]);
  });

  it('moved_sections = anchored sections outside the LCS; neighbours of an insertion do not move', () => {
    const swapped = [
      A('sibling1'), '## Sibling', 'sib', '',
      A('parent01'), '## Parent', 'own', '',
      A('child001'), '### Child', 'child text', '',
    ].join('\n');
    const orig = [
      A('parent01'), '## Parent', 'own', '',
      A('child001'), '### Child', 'child text', '',
      A('sibling1'), '## Sibling', 'sib', '',
    ].join('\n');
    const moved = ser.diff(snap(orig), snap(swapped), 'p.md').moved_sections.map((m) => m.anchor);
    expect(moved).toEqual(['sibling1']);
    const inserted = orig.replace('## Parent', '## Parent\n\n' + A('newone01') + '\n### New\nx\n');
    expect(ser.diff(snap(orig), snap(inserted), 'p.md').moved_sections).toEqual([]);
  });

  it('noise: blank lines and orphan anchor lines outside code are filtered; inside a code block they count', () => {
    const withFence = [A('s0000001'), '## S', '```md', 'x', '```', ''].join('\n');
    const d = ser.diff(snap(withFence), snap(withFence.replace('x', 'x\n' + A('example1'))), 'p.md');
    expect(d.modified_sections.map((s) => s.anchor)).toEqual(['s0000001']);
    const noise = ser.diff(snap(withFence), snap(withFence.replace('## S', '## S\n\n')), 'p.md');
    expect(noise.modified_sections).toEqual([]);
  });

  it('never reads FileSnapshotData.anchors — an old row with a code-block anchor makes no phantom section', () => {
    const content = ['```', A('phantom1'), '## In code', '```', ''].join('\n');
    const old = { ...snap(content), anchors: ['phantom1'] };
    const d = ser.diff(old, snap(content), 'p.md');
    expect(d.op).toBe('noop');
    expect(snap(content).anchors).toEqual([]);
  });
});

describe('computeLineDiff', () => {
  it('keeps whitespace changes inside a fence', () => {
    const a = '```\n  x\n```';
    const b = '```\n  x\n\n```';
    expect(computeLineDiff(a, b).lines.some((l) => l.op === 'added')).toBe(true);
  });
});
