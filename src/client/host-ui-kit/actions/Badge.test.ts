import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Badge } from './Badge.js';

/**
 * 2.1.16 (M34 L12 — `Badge { …; variant?: 'default'|'broken' = 'default' }`):
 * the `broken` variant draws red ink and hairline with a ⚠ prefix and wins
 * over `color` and `active`.
 */
const RED = 'var(--c-red, #c45a3b)';
const GIVEN = '#12ab34';

describe('Badge variant broken (M34)', () => {
  it('[ac:ac-badge-z-variant-broken-renderuje-wari] renders red regardless of the given color', () => {
    const html = renderToStaticMarkup(createElement(Badge, { label: 'dto-gone', color: GIVEN, variant: 'broken' }));
    expect(html).toContain('⚠');
    expect(html).toContain(`color:${RED}`);
    expect(html).toContain(`border:1px solid ${RED}`);
    // The supplied color is ignored entirely — no dot, ink or border carries it.
    expect(html).not.toContain(GIVEN);
  });

  it('[ac:ac-badge-z-variant-broken-renderuje-wari] stays red when active — broken beats active fill', () => {
    const html = renderToStaticMarkup(
      createElement(Badge, { label: 'dto-gone', color: GIVEN, active: true, variant: 'broken' }),
    );
    expect(html).toContain(`color:${RED}`);
    expect(html).toContain('background:var(--c-panel)');
    expect(html).not.toContain(GIVEN);
    expect(html).not.toContain('color:#fff');
  });

  it('the default variant keeps the given color (control)', () => {
    const html = renderToStaticMarkup(createElement(Badge, { label: 'tag', color: GIVEN }));
    expect(html).toContain(GIVEN);
    expect(html).not.toContain('⚠');
  });
});
