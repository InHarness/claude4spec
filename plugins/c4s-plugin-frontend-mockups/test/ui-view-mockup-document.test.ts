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
  it('runs doctype → head(meta, title, style) → body — three points, not four', () => {
    const d = doc();
    const at = (s: string) => d.indexOf(s);
    expect(at('<!doctype html>')).toBe(0);
    expect(at('<meta charset="utf-8">')).toBeGreaterThan(at('<head>'));
    expect(at('<title>')).toBeGreaterThan(at('<meta charset="utf-8">'));
    // The sheet is LAST in the head, so it cannot be separated from the body.
    expect(at('<style>')).toBeGreaterThan(at('<title>'));
    expect(at('<body>')).toBeGreaterThan(at('</head>'));
    expect(at('<main>')).toBeGreaterThan(at('<body>'));
    expect(at('<main>')).toBeLessThan(at('</body>'));
  });

  it('reserves NOTHING after the fragment — the harness slot is gone', () => {
    // 0.2.49 retired the fourth point of the contract. Switching a preview
    // variant is a query param and a CSS selector, so the document needs no
    // script of its own; a slot still standing would promise one that will
    // never arrive.
    const d = doc();
    expect(d).not.toContain('preview harness slot');
    expect(d).not.toContain('<script>');
    expect(d).toContain('<main><h1>Profile</h1></main>\n</body>');
  });

  it('carries the view title and the project lang', () => {
    expect(doc({ lang: 'pl' })).toContain('<html lang="pl">');
    expect(doc()).toContain('<title>User Profile</title>');
  });
});

describe('the variant axes', () => {
  /**
   * ON `<html>`, never on `<body>` and never on a wrapper. A mode redefines
   * custom properties, and the override has to sit above everything the author
   * wrote — including anything at the very top of the fragment.
   */
  it('puts both attributes on the root element', () => {
    const d = doc({ state: 'empty', mode: 'dark' });
    expect(d).toContain('<html lang="en" data-preview-state="empty" data-preview-mode="dark">');
    expect(d).not.toContain('<body data-preview');
  });

  it('treats the two axes as independent', () => {
    expect(doc({ state: 'empty' })).toContain('<html lang="en" data-preview-state="empty">');
    expect(doc({ mode: 'dark' })).toContain('<html lang="en" data-preview-mode="dark">');
  });

  it('emits NO attribute for an axis at its default — absence is the signal', () => {
    // There is no sentinel value for "default variant". An empty attribute
    // would match `[data-preview-state]` and become a variant of its own.
    const d = doc();
    expect(d).toContain('<html lang="en">');
    expect(d).not.toContain('data-preview-state');
    expect(d).not.toContain('data-preview-mode');
  });

  it('escapes a variant value for the attribute context', () => {
    // Belt and braces: the route whitelists the value long before it gets
    // here, but this layer writes the attribute and so owns its escaping.
    expect(doc({ state: 'a"onload="x' })).not.toContain('"onload="x');
  });

  it('warns when a variant is well-formed but undeclared, and still emits it', () => {
    // A document with an attribute nothing styles is pixel-for-pixel identical
    // to one with no attribute, so the comment is the only signal that would
    // tell a typo apart from a mockup that simply does not draw the state.
    const d = doc({ state: 'noSuch', unknownState: 'noSuch', mode: 'neon', unknownMode: 'neon' });
    expect(d).toContain('data-preview-state="noSuch"');
    expect(d).toContain('data-preview-mode="neon"');
    expect(d).toMatch(/<!--[^>]*state 'noSuch' is not declared/);
    expect(d).toMatch(/<!--[^>]*mode 'neon' is not a mode/);
  });

  it('says nothing when both variants are declared', () => {
    const d = doc({ state: 'empty', mode: 'dark' });
    expect(d).not.toContain('is not declared');
    expect(d).not.toContain('is not a mode');
  });

  it('will not let an unknown variant break out of its warning comment', () => {
    const d = doc({ state: 'x', unknownState: '--><script>alert(1)</script>' });
    expect(d).not.toContain('--><script>');
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

  it('closes the warning comment against `--!>` as well as `-->`', () => {
    // The tokenizer's comment-end-BANG state ends a comment on `--!>`, and
    // `designSystemSlug` has no slug pattern (dangling refs are legal), so the
    // sequence is reachable by a plain PATCH. Left in, the warning's tail would
    // become character data in `<head>` and shunt the parser into `<body>`
    // ahead of the `<style>` element.
    for (const slug of ['x-->y', 'x--!>y', 'x---!>y']) {
      const doc = renderMockupDocument({
        title: 'T',
        mockupHtml: null,
        stylesheet: '',
        lang: 'en',
        missingDesignSystemSlug: slug,
      });
      const warning = doc.slice(doc.indexOf('<!-- claude4spec: design system'));
      const end = warning.indexOf('-->');
      // Exactly one terminator, and it is the one this file wrote.
      expect(warning.slice(0, end)).not.toMatch(/--!?>/);
      expect(doc).toContain('<style>');
      expect(doc.indexOf('<style>')).toBeLessThan(doc.indexOf('<body>'));
    }
  });
});
