import { describe, it, expect } from 'vitest';
import { getRenderer } from './toolRenderers.js';

/**
 * `find_references` takes a discriminated `target` — entity, section or page.
 * The panel's summary read `type`/`slug` unconditionally, and those two fields
 * exist on ONE of the three variants, so a section or page sweep rendered as
 * the literal "Find refs to ? ?". The tool changed shape in 0.2.3; this call
 * site was left on the old one.
 */
describe('toolRenderers — find_references summary', () => {
  // Registry keys are fully qualified; `find_references` is served by the
  // in-process `reference-tools` server the chat agent actually mounts.
  const renderer = getRenderer('mcp__reference-tools__find_references');
  const summarize = (input: unknown, result?: unknown) => {
    if (!renderer) throw new Error('find_references renderer not registered');
    return renderer.summary(input, result);
  };

  it('names the entity for target: "entity"', () => {
    expect(summarize({ target: 'entity', type: 'dto', slug: 'page-ref' })).toBe(
      'Find refs to dto page-ref',
    );
  });

  it('names the anchor for target: "section" instead of rendering "? ?"', () => {
    const out = summarize({ target: 'section', anchor: 'zpn3gaip' });
    expect(out).toBe('Find refs to section zpn3gaip');
    expect(out).not.toContain('?');
  });

  it('names the full page key for target: "page"', () => {
    const out = summarize({ target: 'page', rootId: 'pages', path: 'mcp/mcp-c4s-reader.md' });
    expect(out).toBe('Find refs to page pages/mcp/mcp-c4s-reader.md');
    expect(out).not.toContain('?');
  });

  /** The hit count is appended for every variant, not just the entity one. */
  it('appends the reference count when the result carries one', () => {
    expect(summarize({ target: 'section', anchor: 'zpn3gaip' }, { references: [{}, {}, {}] })).toBe(
      'Find refs to section zpn3gaip (3)',
    );
  });

  /**
   * A call captured before the discriminator existed has no `target`. It still
   * carries `type`/`slug`, so it must keep rendering as an entity rather than
   * falling into a placeholder — old transcripts are replayed in this panel.
   */
  it('treats a target-less legacy call as an entity call', () => {
    expect(summarize({ type: 'ac', slug: 'ac-foo' })).toBe('Find refs to ac ac-foo');
  });

  /** A malformed call still renders rather than throwing out of the panel. */
  it('falls back to placeholders instead of throwing on a shapeless input', () => {
    expect(summarize({})).toBe('Find refs to ? ?');
  });
});
