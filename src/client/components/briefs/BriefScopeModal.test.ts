import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Root } from '../../../shared/types.js';
import { BriefScopeFields, briefScopeTargets, probeChangedCount } from './BriefScopeModal.js';

/**
 * M21 (2.1.8) — the "Generate brief" modal's scope (`m21m17ax`, `6e16sj44`):
 * mode (a) "whole release" is the default and sends no `roots`; mode (b) lists
 * every root of kind `pages` — the same set as (a) — each with its own
 * changed-page count, and one entity count shared by every row. One submit is
 * one brief: the selection travels as a single `roots` array.
 */

const USER_ROOTS: Root[] = [
  { id: 'docs', name: 'Docs', dir: 'docs', builtin: true },
  { id: 'skills', name: 'Skills', dir: '.claude/skills', builtin: false },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Generate brief — scope of page spaces', () => {
  it('[ac:ac-modal-generate-brief-ma-scope-przestr] offers whole-release by default and, in mode (b), every `pages` root with a per-root count and one shared entity count', async () => {
    // (a) is the default: no root list, nothing to select.
    const scopes: unknown[] = [];
    const whole = renderToStaticMarkup(
      createElement(BriefScopeFields, {
        fromReleaseName: 'v1',
        toReleaseName: 'v2',
        roots: USER_ROOTS,
        onChange: (s) => scopes.push(s),
      }),
    );
    expect(whole).toContain('Whole release');
    expect(whole).toContain('Selected roots');
    const labels = whole.split('<label').slice(1);
    const wholeLabel = labels.find((l) => l.includes('Whole release'))!;
    const rootsLabel = labels.find((l) => l.includes('Selected roots'))!;
    expect(wholeLabel).toMatch(/<input type="radio" name="brief-scope"[^>]*checked=""/);
    expect(rootsLabel).not.toContain('checked=""');
    expect(whole).not.toContain('type="checkbox"');
    expect(scopes).toEqual([]);

    // (b) lists exactly the registry's `pages` roots — the user roots, the base
    // root included whatever its id — and never a system root.
    const targets = briefScopeTargets(USER_ROOTS);
    expect(targets.map((r) => [r.id, r.kind])).toEqual([
      ['docs', 'pages'],
      ['skills', 'pages'],
    ]);
    for (const system of ['plans', 'briefs', 'patches', 'entities', 'releases']) {
      expect(targets.map((r) => r.id)).not.toContain(system);
    }

    const selected = renderToStaticMarkup(
      createElement(BriefScopeFields, {
        fromReleaseName: 'v1',
        toReleaseName: 'v2',
        roots: USER_ROOTS,
        onChange: () => {},
        initialMode: 'roots',
      }),
    );
    expect(selected.match(/type="checkbox"/g)).toHaveLength(2);
    for (const root of USER_ROOTS) {
      expect(selected).toContain(`>${root.name}</span>`);
      expect(selected).toContain(`>${root.id}</span>`);
    }
    // One per-root count cell per row (still loading in a static render) …
    expect(selected.match(/font-mono text-\[11px\][^>]*>(…|—|\d+ changed)</g)).toHaveLength(2);
    // … and exactly one entity row, shared by every root.
    expect(selected.match(/data-testid="brief-scope-entity-count"/g)).toHaveLength(1);
    expect(selected).toContain('Entities (shared by every root)');

    // The per-root count is the page dimension of a diff narrowed to that one
    // root; the entity count is the same answer's entity dimension.
    const fetch = vi.fn(async (url: string) =>
      new Response(JSON.stringify({ pages: [{ path: 'a.md' }, { path: 'b.md' }], entities: [{ slug: 'e' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    let entities: number | null = null;
    const pages = await probeChangedCount('v1', 'v2', 'skills', (n) => {
      entities = n;
    });
    expect(pages).toBe(2);
    expect(entities).toBe(1);
    const url = String(fetch.mock.calls[0]?.[0]);
    expect(url).toContain('/releases/v1/diff/v2?');
    expect(new URL(url, 'http://x').searchParams.get('roots')).toBe('skills');
    expect(new URL(url, 'http://x').searchParams.get('summaryOnly')).toBe('true');
  });
});
