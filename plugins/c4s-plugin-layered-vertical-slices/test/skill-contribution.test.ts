import { describe, expect, it } from 'vitest';
import { checksProjection, extractChecks, includeUsage, layeredVerticalSlicesStyle as style } from '../src/skills/layered-vertical-slices.js';

/**
 * The style travels as LITERALS compiled into this module — `?raw` imports that
 * Vite inlines at build time — rather than as files the host reads lazily. These
 * tests are about that carriage, not about the prose: what can break here is an
 * import that resolved to nothing, a frontmatter block that survived into the
 * body, or a package key that drifted away from the address the prose uses.
 */
/** Symptom markers across `parts/placement.md` + `parts/authoring.md` + `parts/domain.md`. */
const CHECKS_PINNED = 23;

describe('c4s-plugin-layered-vertical-slices — the writing style it contributes', () => {
  it('is the reference style, at the slug config.writingStyle names', () => {
    expect(style.slug).toBe('layered-vertical-slices');
    expect(style.title).toBe('Layered Vertical Slices');
    expect(style.version).toBe(2);
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

  /**
   * The core is what every thread pays for on every turn until the first
   * compaction; the rules travel with the workflows. A thousand words is the
   * gate, not a target — the target is lower — and a core that grows past it
   * has absorbed something a workflow should carry.
   */
  it('keeps the always-on core under a thousand words', () => {
    expect(style.content.split(/\s+/).length).toBeLessThanOrEqual(1000);
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

  /**
   * The check list is READ off the `*Symptom:*` markers, not kept as a list. The
   * count is pinned so that a marker lost in an edit — a rule silently dropping
   * out of both projections — fails here rather than in a review that never
   * looks for it.
   */
  it('projects one check per symptom marker into daily step 5 and nowhere else twice', () => {
    const daily = style.files?.['workflows/daily.md'] ?? '';
    const checks = checksProjection.split('\n');
    expect(checks.length).toBe(CHECKS_PINNED);
    for (const check of checks) {
      expect(check).toMatch(/^- \*\*(Rule \d+[a-z]? — |Cel \d+ — |Dom \d+ — ).+\.\*\* .+/);
    }
    expect(daily).toContain(checksProjection);
    // Every marker in the delivered rules is projected — none is orphaned.
    const markers = (daily.match(/\*Symptom:\*/g) ?? []).length;
    expect(markers).toBe(CHECKS_PINNED);
    // And the extractor attributes a symptom to the rule it sits under.
    expect(extractChecks('## X\n\n3. **Title.** Body. *Symptom:* thing.\n')).toEqual(['- **Rule 3 — Title.** thing.']);
    // The prefix comes from the nearest H2, not from the `###` the items sit under:
    // the `Cel` and `Domain` catalogues carry the same kind of sub-heading.
    expect(
      extractChecks("## The module's `Domain` section\n\n### Rules\n\n2. **T.** *Symptom:* s.\n"),
    ).toEqual(['- **Dom 2 — T.** s.']);
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
   * A PACKAGE NAMES ONLY THE TYPES IT SHIPS.
   *
   * This envelope registers exactly one entity type — `module-dependency` — so
   * that is the only `type` identifier its authored content may name outright.
   * `ac` is registered by a different envelope (`c4s-plugin-ac`) and may be
   * absent, so no shipped surface may put a LIVE `ac` embed in front of a reader:
   * in a project without the type it selects nothing and renders empty, with no
   * error to say why. The conditional prose that names `ac` behind an explicit
   * "only if this project models AC as entities" is fine — what is pinned here is
   * that nothing UNCOMMENTED embeds it.
   */
  it('ships no live embed of a type this envelope does not register', () => {
    // What counts is an embed a reader would COPY into a spec file. An HTML
    // comment is where the conditional variant is allowed to show the tag, and a
    // code span or fence is prose quoting the syntax (SKILL.md §2 illustrates the
    // slice-schema form with `<tagged_list type="endpoint" .../>`); neither ships
    // an embed. Everything left is live.
    const live = (text: string) =>
      text
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`\n]*`/g, '');
    const shipped: Array<[string, string]> = [
      ['SKILL.md', style.content],
      ...Object.entries(style.files ?? {}),
    ];
    for (const [where, text] of shipped) {
      const embed = /<(?:tagged_list|element_list|inline_mention|single_element)\b[^>]*\btype="([^"]+)"/g;
      for (const [, type] of live(text).matchAll(embed)) {
        expect({ where, type }).toEqual({ where, type: 'module-dependency' });
      }
    }

    // The counterexample that keeps the assertion honest: the one type this
    // envelope DOES register keeps its live embed, in the module template.
    expect(style.files?.['templates/module.md']).toContain('<tagged_list type="module-dependency" tags="mXX"/>');
  });

  /**
   * And the section itself stays — the style owns `## Acceptance criteria`
   * unconditionally, only the entity type backing it is conditional. What a
   * copied template lands is therefore the inline observable checklist.
   */
  it('gives both templates an inline checklist as the live body of `## Acceptance criteria`', () => {
    for (const file of ['templates/module.md', 'templates/index.md']) {
      const text = style.files?.[file] ?? '';
      const section = text.slice(text.indexOf('## Acceptance criteria'));
      const body = section.slice(0, section.indexOf('<!--'));
      expect({ file, checklist: /^- \[ \] /m.test(body) }).toEqual({ file, checklist: true });
    }
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
