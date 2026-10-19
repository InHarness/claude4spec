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
