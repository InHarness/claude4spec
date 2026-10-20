import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Badge } from './Badge.js';

/**
 * 2.1.16 / 2.1.39 (M34 L12 — `Badge { …; variant?: 'default'|'broken' = 'default' }`):
 * the `broken` variant draws red ink and hairline with a ⚠ prefix and wins
 * over `foreground` (`color` and `active` are gone with the tag-chip role).
 */
const RED = 'var(--c-red, #c45a3b)';
const GIVEN = '#12ab34';

describe('Badge variant broken (M34)', () => {
  it('[ac:ac-badge-z-variant-broken-renderuje-wari] renders red regardless of the given foreground', () => {
    const html = renderToStaticMarkup(createElement(Badge, { label: 'dto-gone', foreground: GIVEN, variant: 'broken' }));
    expect(html).toContain(`color:${RED}`);
    expect(html).toContain(`border:1px solid ${RED}`);
    expect(html).toContain('background:var(--c-panel)');
    // The supplied foreground is ignored entirely — neither ink nor border carries it.
    expect(html).not.toContain(GIVEN);
  });

  it('[ac:ac-badge-z-variant-broken-poprzedza-etyk] puts the ⚠ prefix before the label', () => {
    const html = renderToStaticMarkup(createElement(Badge, { label: 'dto-gone', variant: 'broken' }));
    expect(html.indexOf('⚠')).toBeGreaterThan(-1);
    expect(html.indexOf('⚠')).toBeLessThan(html.indexOf('dto-gone'));
  });

  it('the default variant keeps the given foreground and draws no ⚠ (control)', () => {
    const html = renderToStaticMarkup(createElement(Badge, { label: 'GET', foreground: GIVEN }));
    expect(html).toContain(`color:${GIVEN}`);
    expect(html).not.toContain('⚠');
  });
});

/**
 * 2.1.41 (M34) — `Badge` is never a link: a link to a record is `EntityRefValue`,
 * an action or a link without a record identity is a ghost `ActionButton`.
 * Checked over every catalog component's source: no `<Badge>` carries an
 * `onClick` / `href`, and none sits inside an `<a>`.
 */
describe('Badge is never a link (M34, 2.1.41)', () => {
  it('[ac:ac-badge-nie-renderuje-sie-jako-link-w-z] no catalog component renders Badge as a link', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const kit = fileURLToPath(new URL('..', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.tsx') && !name.includes('.test.')) files.push(full);
      }
    };
    walk(kit);
    expect(files.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      // Every `<Badge … />` / `<Badge …>` opening tag, props included.
      for (const m of src.matchAll(/<Badge\b([^>]*?)\/?>/gs)) {
        if (/\b(onClick|href|onKeyDown|role)\s*=/.test(m[1]!)) offenders.push(`${file}: ${m[0]}`);
      }
      // A Badge nested in an anchor.
      for (const m of src.matchAll(/<a\b[^>]*>((?:(?!<\/a>).)*)<\/a>/gs)) {
        if (/<Badge\b/.test(m[1]!)) offenders.push(`${file}: <a> around Badge`);
      }
    }
    expect(offenders).toEqual([]);

    // And the component itself offers no way to become one.
    const html = renderToStaticMarkup(createElement(Badge, { label: 'x', onClick: () => {} } as never));
    expect(html).not.toMatch(/<a\b|<button\b|role="button"|tabindex/);
  });
});
