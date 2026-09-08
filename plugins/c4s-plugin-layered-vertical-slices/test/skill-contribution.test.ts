import { describe, expect, it } from 'vitest';
import { includeUsage, layeredVerticalSlicesStyle as style } from '../src/skills/layered-vertical-slices.js';

/**
 * The style travels as LITERALS compiled into this module — `?raw` imports that
 * Vite inlines at build time — rather than as files the host reads lazily. These
 * tests are about that carriage, not about the prose: what can break here is an
 * import that resolved to nothing, a frontmatter block that survived into the
 * body, or a package key that drifted away from the address the prose uses.
 */
describe('c4s-plugin-layered-vertical-slices — the writing style it contributes', () => {
  it('is the reference style, at the slug config.writingStyle names', () => {
    expect(style.slug).toBe('layered-vertical-slices');
    expect(style.title).toBe('Layered Vertical Slices');
    expect(style.version).toBe(1);
    expect(style.language).toBe('en');
    expect(style.description.length).toBeGreaterThan(0);
  });

  it('carries the BODY of SKILL.md, with the frontmatter stripped', () => {
    // The metadata above is the contribution's own; a frontmatter block reaching
    // the body would be rendered to the agent as if it were prose.
    expect(style.content.startsWith('---')).toBe(false);
    expect(style.content).not.toContain('language: en');
    expect(style.content.startsWith('# Layered Specification Meta-Prompt')).toBe(true);
    expect(style.content.length).toBeGreaterThan(1000);
  });

  it('carries the whole package, addressed by POSIX path', () => {
    // These keys are the addresses `load_skill_file(slug, file)` takes and the ones
    // the style's own prose cross-references, so the map's shape is part of the
    // contribution rather than an implementation detail of it.
    expect(Object.keys(style.files ?? {}).sort()).toEqual([
      'templates/index.md',
      'templates/layer.md',
      'templates/module.md',
      'workflows/bootstrap.md',
      'workflows/brief.md',
      'workflows/daily.md',
      'workflows/patch.md',
    ]);
    for (const [file, content] of Object.entries(style.files ?? {})) {
      expect(content.length, file).toBeGreaterThan(100);
      expect(content, file).toContain('#');
    }
  });

  /**
   * The caller's protocol for reading `spec-review`'s answer, asserted on the file the
   * caller actually loads. The set of shapes has to be DISJOINT and CLOSED, and one of the
   * shapes has to be the empty return: that is the only outcome that arrives as silence,
   * and a caller that has no name for it relays a review that never happened as a clean
   * one. What is asserted is the shape of the set, not any particular wording.
   */
  it('daily.md names the empty return as one shape of a closed, disjoint set', () => {
    const daily = style.files?.['workflows/daily.md'] ?? '';
    expect(daily).toMatch(/exactly one of five shapes/);
    expect(daily).toMatch(/set is closed/);
    expect(daily).toMatch(/mutually exclusive/);
    expect(daily).toMatch(/empty return/);
    expect(daily).toMatch(/turn budget/);
    expect(daily).toContain('review not performed');
    // Not a retry: the second run exhausts the same way.
    expect(daily).toMatch(/not\*\* re-run it on the same scope/);
  });

  /**
   * One home in source, N deliveries: `parts/*` are spliced in at import and
   * are not addresses. What can break is a marker that survived into a shipped
   * string (the agent would read an HTML comment where a rule should be), a
   * part nobody delivers (a rule with a home and no reader), or a part that
   * leaked into the address map (two answers to "where does this rule live").
   */
  it('splices every part somewhere and ships no unexpanded include marker', () => {
    const shipped = [style.content, ...Object.values(style.files ?? {})];
    for (const text of shipped) {
      expect(text).not.toMatch(/<!--\s*include:/);
    }
    for (const [name, uses] of Object.entries(includeUsage)) {
      expect({ name, uses: uses > 0 }).toEqual({ name, uses: true });
    }
    expect(Object.keys(style.files ?? {}).some((k) => k.startsWith('parts/'))).toBe(false);
  });

  it('delivers the reading protocols with the workflows that locate a change, and only the pattern to the brief', () => {
    const daily = style.files?.['workflows/daily.md'] ?? '';
    const patch = style.files?.['workflows/patch.md'] ?? '';
    const brief = style.files?.['workflows/brief.md'] ?? '';
    for (const doc of [daily, patch]) {
      expect(doc).toContain('## Cross-cutting reading protocol 1');
      expect(doc).toContain('## Cross-cutting reading protocol 2');
    }
    // The brief thread has no `search_pages`: it gets the one line it can use.
    expect(brief).not.toContain('## Cross-cutting reading protocol');
    expect(brief).toContain('[Mm]odules/');
    expect(style.content).not.toContain('## Cross-cutting reading protocol');
  });

  /**
   * `contributes.writingStyles[]` is sugar for `contributes.skills[]` with
   * `scope: 'writing-style'` — the host lowers it, so declaring a scope here would
   * be the shape of the OTHER slot.
   */
  it('declares no scope of its own', () => {
    expect('scope' in style).toBe(false);
  });
});
