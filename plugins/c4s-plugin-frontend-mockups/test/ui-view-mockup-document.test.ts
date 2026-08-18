import { describe, expect, it } from 'vitest';
import { renderMockupDocument } from '../src/entity/ui-view/backend/document.js';

/**
 * The mockup document. The ORDER of its elements is a contract, so most of what
 * follows is an ordering assertion rather than a content one.
 */

const sheet = 'body { margin: 0; }\n';
const doc = (over: Partial<Parameters<typeof renderMockupDocument>[0]> = {}) =>
  renderMockupDocument({
    title: 'User Profile',
    mockupHtml: '<main><h1>Profile</h1></main>',
    stylesheet: sheet,
    lang: 'en',
    ...over,
  });

describe('element order is the contract', () => {
  it('runs doctype → head(meta, title, style) → body → script slot', () => {
    const d = doc();
    const at = (s: string) => d.indexOf(s);
    expect(at('<!doctype html>')).toBe(0);
    expect(at('<meta charset="utf-8">')).toBeGreaterThan(at('<head>'));
    expect(at('<title>')).toBeGreaterThan(at('<meta charset="utf-8">'));
    // The sheet is LAST in the head, so it cannot be separated from the body.
    expect(at('<style>')).toBeGreaterThan(at('<title>'));
    expect(at('<body>')).toBeGreaterThan(at('</head>'));
    expect(at('preview harness slot')).toBeGreaterThan(at('<main>'));
    expect(at('preview harness slot')).toBeLessThan(at('</body>'));
  });

  it('carries the view title and the project lang', () => {
    expect(doc({ lang: 'pl' })).toContain('<html lang="pl">');
    expect(doc()).toContain('<title>User Profile</title>');
  });
});

describe('the sheet is inline', () => {
  /**
   * Atomicity, no FOUC, and a document that still renders when saved to a file
   * — all three die the moment the CSS becomes a second request.
   */
  it('embeds the whole sheet and requests no CSS subresource', () => {
    const d = doc();
    expect(d).toContain(sheet.trim());
    expect(d).not.toContain('<link');
    expect(d).not.toContain('@import');
  });
});

describe('mockupHtml is written literally', () => {
  it('does not parse, validate or repair the fragment', () => {
    // Unclosed tags, stray whitespace, a stray `<` — all of it survives.
    const messy = '  <div>\n  <p>unclosed\n\n';
    expect(doc({ mockupHtml: messy })).toContain(messy);
  });

  it('passes a script in the mockup through untouched — sanitising is not this layer', () => {
    // The isolation contract is the route's CSP header, NOT scrubbing here.
    const withScript = '<script>window.x=1</script>';
    expect(doc({ mockupHtml: withScript })).toContain(withScript);
  });

  it('nests an author-supplied full document rather than rejecting it', () => {
    const full = '<html><head></head><body>hi</body></html>';
    expect(doc({ mockupHtml: full })).toContain(full);
  });
});

describe('degradation — none of these is an error', () => {
  it('shows a placeholder, not a 404 body, when there is no mockup', () => {
    for (const empty of [null, '']) {
      const d = doc({ mockupHtml: empty });
      expect(d).toContain('data-mockup-placeholder');
      expect(d).toContain('<!doctype html>');
    }
  });

  /**
   * The warning matters because a document with no tokens renders perfectly
   * and is indistinguishable from a mockup meant to be unstyled.
   */
  it('comments a warning when the design-system relation is broken', () => {
    const d = doc({ missingDesignSystemSlug: 'gone-ds' });
    expect(d).toContain('gone-ds');
    expect(d).toMatch(/<!--[^>]*not found/);
  });

  it('says nothing when the relation is fine', () => {
    expect(doc()).not.toContain('not found');
  });

  it('will not let a slug break out of the warning comment into markup', () => {
    const d = doc({ missingDesignSystemSlug: '--><script>alert(1)</script>' });
    expect(d).not.toContain('--><script>');
  });

  it('escapes a title that would otherwise close the element', () => {
    expect(doc({ title: '</title><script>alert(1)</script>' })).not.toContain('</title><script>');
  });
});
