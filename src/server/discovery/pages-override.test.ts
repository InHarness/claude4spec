import { describe, expect, it } from 'vitest';
import { applyPagesOverride } from './pages-override.js';
import type { Root } from '../../shared/types.js';

const root = (id: string, dir: string, extra: Partial<Root> = {}): Root => ({
  id,
  dir,
  name: id,
  builtin: false,
  ...extra,
});

const PROJECT = '/repo/spec';

const refuse = (roots: Root[], override: string): { code?: string; hint?: string } | null => {
  try {
    applyPagesOverride(roots, override, PROJECT);
    return null;
  } catch (e) {
    return e as { code?: string; hint?: string };
  }
};

/** 2.1.8 — M11 L13 / M19 L14: `--pages` overrides only the `builtin` root's `dir`. */
describe('applyPagesOverride', () => {
  const roots = [
    root('pages', 'pages', { builtin: true }),
    root('guides', 'docs/guides', { builtin: false }),
    root('adr', 'docs/adr', { builtin: false }),
  ];

  it('is a no-op without an override', () => {
    expect(applyPagesOverride(roots, undefined, PROJECT)).toEqual({ roots, unindexedRootIds: new Set() });
  });

  it('re-points ONLY the builtin root: its id stays, every other page root is still swept', () => {
    const out = applyPagesOverride(roots, 'drafts', PROJECT);
    expect(out.roots).toEqual([root('pages', 'drafts', { builtin: true }), roots[1], roots[2]]);
    // The index was built over `pages/` — the re-pointed root's hits carry no anchor.
    expect([...out.unindexedRootIds]).toEqual(['pages']);
  });

  it('does not recognise a root by its dir — naming another root\'s dir still re-points the builtin one', () => {
    const out = applyPagesOverride(roots, 'docs/adr', PROJECT);
    expect(out.roots.map((r) => [r.id, r.dir])).toEqual([
      ['pages', 'docs/adr'],
      ['guides', 'docs/guides'],
      ['adr', 'docs/adr'],
    ]);
  });

  it('any spelling of the configured dir changes nothing, anchors included', () => {
    for (const spelling of ['pages', './pages', 'pages/', `${PROJECT}/pages`, 'docs/../pages']) {
      expect(applyPagesOverride(roots, spelling, PROJECT), spelling).toEqual({ roots, unindexedRootIds: new Set() });
    }
  });

  it('`--pages .` is accepted — the walk skips dot-segment subtrees, so it never reaches .claude4spec/', () => {
    for (const whole of ['.', './', PROJECT, `${PROJECT}/`, 'docs/..']) {
      expect(applyPagesOverride(roots, whole, PROJECT).roots[0], whole).toEqual(root('pages', '.', { builtin: true }));
    }
  });

  it('normalizes the dir it hands on, so one spelling reaches PagesService', () => {
    expect(applyPagesOverride(roots, './drafts/', PROJECT).roots[0]!.dir).toBe('drafts');
  });

  it('REFUSES an override that resolves outside the project', () => {
    // It arrives as `?pages=` over HTTP and through the MCP mount; `PageSource`
    // has no containment check of its own. Refused rather than clamped.
    for (const escape of ['../..', '/etc', `${PROJECT}/../other`, 'docs/../../elsewhere']) {
      const err = refuse(roots, escape);
      expect(err, escape).not.toBeNull();
      expect(err!.code, escape).toBe('INVALID_ARGUMENT');
      expect(err!.hint, escape).toContain('inside the project');
    }
  });

  it('2.1.4: the target is the `builtin` entry, whatever its id or position', () => {
    const renamedBase = [root('guides', 'docs/guides'), root('docs', 'docs/main', { builtin: true })];
    const out = applyPagesOverride(renamedBase, 'x', PROJECT);
    expect(out.roots).toEqual([renamedBase[0], root('docs', 'x', { builtin: true })]);
    expect([...out.unindexedRootIds]).toEqual(['docs']);
  });
});
