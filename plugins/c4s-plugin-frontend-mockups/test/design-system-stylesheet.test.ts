import { describe, expect, it } from 'vitest';
import { DesignSystemService } from '../src/entity/design-system/backend/service.js';
import { generateStylesheet } from '../src/entity/design-system/backend/stylesheet.js';
import { UNRESOLVED_TOKEN } from '../src/types.js';

/**
 * The token → CSS sheet generator.
 *
 * Almost every case here is a STRUCTURAL guarantee: whatever an author (or an
 * agent writing on their behalf) puts in a token name or value, the sheet that
 * comes out still parses and the blocks that follow still apply. None of it is
 * the isolation contract — that is the route's CSP header, tested elsewhere.
 */

const svc = new DesignSystemService();

describe('the sheet — three layers, in order', () => {
  it('puts the reset first, :root second, mode blocks last', () => {
    const css = generateStylesheet(
      { bg: '#fff' },
      [{ name: 'dark', tokens: { bg: '#000' } }],
    );
    const reset = css.indexOf('box-sizing');
    const root = css.indexOf(':root');
    const mode = css.indexOf('[data-preview-mode="dark"]');
    expect(reset).toBeGreaterThanOrEqual(0);
    expect(root).toBeGreaterThan(reset);
    expect(mode).toBeGreaterThan(root);
  });

  it('emits base tokens as custom properties on :root', () => {
    expect(generateStylesheet({ 'color-bg': '#fff' })).toContain('--color-bg: #fff;');
  });

  /**
   * The selector is element-agnostic ON PURPOSE. Pinned to `body`, a mockup
   * author could not activate a mode without a script; as it stands they wrap a
   * subtree in `<div data-preview-mode="dark">` and inheritance does the rest.
   */
  it('never pins the mode selector to an element', () => {
    const css = generateStylesheet({ bg: '#fff' }, [{ name: 'dark', tokens: { bg: '#000' } }]);
    expect(css).toContain('[data-preview-mode="dark"] {');
    expect(css).not.toMatch(/body\s*\[data-preview-mode/);
    expect(css).not.toMatch(/html\s*\[data-preview-mode/);
  });

  /** A mode IS its overrides — "Base = no overrides" — so restating base is noise. */
  it('keeps a mode block to what actually differs from base', () => {
    const css = generateStylesheet(
      { bg: '#fff', fg: '#111' },
      [{ name: 'dark', tokens: { bg: '#000', fg: '#111' } }],
    );
    const block = css.slice(css.indexOf('[data-preview-mode="dark"]'));
    expect(block).toContain('--bg: #000;');
    expect(block).not.toContain('--fg');
  });

  it('drops a mode block that overrides nothing, rather than emitting an empty rule', () => {
    const css = generateStylesheet({ bg: '#fff' }, [{ name: 'same', tokens: { bg: '#fff' } }]);
    expect(css).not.toContain('data-preview-mode="same"');
  });
});

describe('hygiene — a bad name is skipped, never thrown', () => {
  it('skips a token whose name leaves [A-Za-z0-9_-], and keeps the rest', () => {
    const css = generateStylesheet({ 'bad name{': '#f00', good: '#0f0' });
    expect(css).not.toContain('bad name');
    expect(css).toContain('--good: #0f0;');
  });

  it('skips a mode whose NAME could break the selector, leaving other blocks applying', () => {
    const css = generateStylesheet({ bg: '#fff' }, [
      { name: 'ev"il] { } body {', tokens: { bg: '#f00' } },
      { name: 'dark', tokens: { bg: '#000' } },
    ]);
    expect(css).not.toContain('ev"il');
    expect(css).toContain('[data-preview-mode="dark"]');
    // The sheet's braces still balance — the skipped mode took nothing with it.
    expect((css.match(/{/g) ?? []).length).toBe((css.match(/}/g) ?? []).length);
  });

  it('does not throw on a hostile name — one bad token must not cost the sheet', () => {
    expect(() => generateStylesheet({ '</style><script>': 'x', ok: 'y' })).not.toThrow();
  });
});

describe('hygiene — values are escaped, not blacklisted', () => {
  /**
   * The reason a blacklist was rejected: it would break this while still
   * letting `/*` and a trailing `\` through.
   */
  it('keeps a legitimate url() in a background token', () => {
    expect(generateStylesheet({ bg: 'url(/img/a.png) no-repeat' })).toContain('url');
  });

  it('a value containing } cannot close the rule', () => {
    const css = generateStylesheet({ a: '#fff } body { display:none', b: '#0f0' });
    expect((css.match(/{/g) ?? []).length).toBe((css.match(/}/g) ?? []).length);
    // The token declared AFTER the hostile one is still inside :root.
    expect(css).toContain('--b: #0f0;');
  });

  it('a value containing @import cannot become an at-rule', () => {
    const css = generateStylesheet({ a: '@import url(http://evil.test/x.css);' });
    // It survives as a VALUE — never at the start of a line, where it would parse.
    expect(css).not.toMatch(/^\s*@import/m);
  });

  it('a value containing </ cannot close the host document style element', () => {
    expect(generateStylesheet({ a: '</style><script>alert(1)</script>' })).not.toContain('</style>');
  });

  it('a value opening a comment cannot swallow the declarations after it', () => {
    const css = generateStylesheet({ a: 'red /* ', b: '#0f0' });
    expect(css).toContain('--b: #0f0;');
  });
});

describe('unresolved', () => {
  /** Empty would be a legal declaration that reads as a deliberate zeroing. */
  it('becomes a comment, never an empty custom property', () => {
    const css = generateStylesheet({ broken: UNRESOLVED_TOKEN });
    expect(css).toContain('/* broken: unresolved */');
    expect(css).not.toMatch(/--broken:\s*;/);
  });

  it('an all-unresolved design system still yields a valid, reset-only sheet', () => {
    const css = generateStylesheet({ a: UNRESOLVED_TOKEN, b: UNRESOLVED_TOKEN });
    expect(css).toContain('box-sizing');
    expect(css).not.toMatch(/--[ab]:/);
  });

  it('empty input yields the reset alone', () => {
    const css = generateStylesheet({});
    expect(css).toContain('box-sizing');
    expect(css).not.toContain(':root');
  });
});

describe('composite tokens', () => {
  it('flattens one custom property per field', () => {
    const css = generateStylesheet({ heading: { fontSize: '32px', fontWeight: '700' } });
    expect(css).toContain('--heading-fontSize: 32px;');
    expect(css).toContain('--heading-fontWeight: 700;');
  });

  /**
   * The field key reaches the sheet VERBATIM. Kebab-casing it would be the
   * obvious CSS-idiomatic thing to do and is exactly what the contract forbids:
   * the name is derived by consumers from the token record, so a rewrite here
   * would make every derived `var()` miss.
   */
  it('carries the field key over verbatim and composes no shorthand', () => {
    const css = generateStylesheet({ 'heading-1': { fontSize: '32px', lineHeight: '1.2' } });
    expect(css).toContain('--heading-1-fontSize: 32px;');
    expect(css).not.toContain('--heading-1-font-size');
    expect(css).not.toMatch(/--heading-1:/);
  });

  /**
   * The granularity that separates this from a bad token NAME: there, the whole
   * token goes; here, only the field does.
   */
  it('drops a field whose key fails the name filter, keeping its siblings', () => {
    const css = generateStylesheet({
      'shadow-card': { offsetX: '0px', 'blur.radius': '8px', color: '#0003' },
    });
    expect(css).not.toContain('blur.radius');
    expect(css).toContain('--shadow-card-offsetX: 0px;');
    expect(css).toContain('--shadow-card-color: #0003;');
  });

  /** A shadow whose colour failed still has a usable blur. */
  it('comments out only the field that is unresolved', () => {
    const css = generateStylesheet({ shadow: { blur: '8px', color: UNRESOLVED_TOKEN } });
    expect(css).toContain('--shadow-blur: 8px;');
    expect(css).toContain('/* shadow-color: unresolved */');
  });
});

describe('DesignSystemService', () => {
  it('resolve() delegates to the one domain implementation, aliases and all', () => {
    const groups = [
      { name: 'p', tier: 'primitive' as const, tokens: [{ name: 'blue', type: 'color', value: '#00f' }] },
      { name: 's', tier: 'semantic' as const, tokens: [{ name: 'bg', type: 'color', value: '{blue}' }] },
    ];
    expect(svc.resolve(groups, [])).toEqual({ blue: '#00f', bg: '#00f' });
  });

  /**
   * The fan-out lives here rather than in every caller: a sheet spans all
   * modes while `resolve()` answers for one at a time.
   */
  it('stylesheetFor() resolves once per mode and produces a block for each', () => {
    const groups = [
      { name: 'g', tier: 'primitive' as const, tokens: [{ name: 'bg', type: 'color', value: '#fff' }] },
    ];
    const modes = [
      { name: 'dark', overrides: [{ token: 'bg', value: '#000' }] },
      { name: 'sepia', overrides: [{ token: 'bg', value: '#f4ecd8' }] },
    ];
    const css = svc.stylesheetFor(groups, modes);
    expect(css).toContain('--bg: #fff;');
    expect(css).toContain('[data-preview-mode="dark"]');
    expect(css).toContain('--bg: #000;');
    expect(css).toContain('[data-preview-mode="sepia"]');
  });

  it('a design system with no tokens at all is still a valid sheet, not an error', () => {
    expect(svc.stylesheetFor([], [])).toContain('box-sizing');
  });
});

describe('parentheses — kept, because most real values need them', () => {
  it('leaves url(), calc() and rgba() intact enough to still be functions', () => {
    const css = generateStylesheet({
      bg: 'url(/img/a.png)',
      w: 'calc(100% - 2rem)',
      c: 'rgba(0, 0, 0, 0.5)',
    });
    expect(css).toContain('url(/img/a.png)');
    expect(css).toContain('calc(100% - 2rem)');
    expect(css).toContain('rgba(0, 0, 0, 0.5)');
  });

  it('does not mangle the slash in a font shorthand', () => {
    expect(generateStylesheet({ f: '700 16px/1.5 serif' })).toContain('16px/1.5');
  });

  /**
   * The one case parens could hurt: an unclosed `(` makes the parser consume
   * forward. Dropped silently, like a bad name — the tokens after it survive.
   */
  it('drops a token with unbalanced parens rather than letting it swallow the rest', () => {
    const css = generateStylesheet({ bad: 'url(/img/a.png', good: '#0f0' });
    expect(css).not.toContain('--bad');
    expect(css).toContain('--good: #0f0;');
  });
});
