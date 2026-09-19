import { describe, expect, it } from 'vitest';
import { checksProjection, extractChecks, includeUsage, layeredVerticalSlicesStyle as style } from '../src/skills/layered-vertical-slices.js';
import readSource from '../src/skills/layered-vertical-slices/workflows/read.md?raw';
import planSource from '../src/skills/layered-vertical-slices/workflows/plan.md?raw';
import applySource from '../src/skills/layered-vertical-slices/workflows/apply.md?raw';

/**
 * The style travels as LITERALS compiled into this module — `?raw` imports that
 * Vite inlines at build time — rather than as files the host reads lazily. These
 * tests are about that carriage, not about the prose: what can break here is an
 * import that resolved to nothing, a frontmatter block that survived into the
 * body, or a package key that drifted away from the address the prose uses.
 */
/** Symptom markers across `parts/placement.md` + `parts/authoring.md` + `parts/domain-form.md`. */
const CHECKS_PINNED = 22;

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
    expect(style.content.startsWith('# Layered Vertical Slices')).toBe(true);
    expect(style.content.length).toBeGreaterThan(1000);
  });

  /**
   * The core is what every thread pays for on every turn until the first
   * compaction; the rules travel with the workflows. The core is the grid and
   * the route table, nothing else — a sentence belongs in it only when every
   * thread type needs it before choosing a route AND it is true only in this
   * style. A core that grows past the gate has absorbed something a workflow
   * should carry.
   */
  it('keeps the always-on core under 250 words', () => {
    expect(style.content.split(/\s+/).length).toBeLessThanOrEqual(250);
  });

  it('carries the whole package, addressed by POSIX path', () => {
    // These keys are the addresses `load_skill_file(slug, file)` takes and the ones
    // the style's own prose cross-references, so the map's shape is part of the
    // contribution rather than an implementation detail of it.
    expect(Object.keys(style.files ?? {}).sort()).toEqual([
      'templates/index.md',
      'templates/layer.md',
      'templates/module.md',
      'workflows/apply.md',
      'workflows/bootstrap.md',
      'workflows/brief.md',
      'workflows/patch.md',
      'workflows/plan.md',
      'workflows/read.md',
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
  it('apply.md names the empty return as one shape of a closed, disjoint set', () => {
    const daily = style.files?.['workflows/apply.md'] ?? '';
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
  it('projects one check per symptom marker into apply step 3 and nowhere else twice', () => {
    const daily = style.files?.['workflows/apply.md'] ?? '';
    const checks = checksProjection.split('\n');
    expect(checks.length).toBe(CHECKS_PINNED);
    for (const check of checks) {
      expect(check).toMatch(/^- \*\*(Rule \d+[a-z]? — |Cel \d+ — |Dom \d+ — ).+\.\*\* .+/);
    }
    expect(daily).toContain(checksProjection);
    // Every marker in the delivered rules is projected — none is orphaned. The
    // rules split by phase: placement rides `plan.md`, the text-decidable rest
    // `apply.md`, and together they carry each marker exactly once.
    const plan = style.files?.['workflows/plan.md'] ?? '';
    const markers = [plan, daily].reduce((n, doc) => n + (doc.match(/\*Symptom:\*/g) ?? []).length, 0);
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
    const read = style.files?.['workflows/read.md'] ?? '';
    const plan = style.files?.['workflows/plan.md'] ?? '';
    const patch = style.files?.['workflows/patch.md'] ?? '';
    const brief = style.files?.['workflows/brief.md'] ?? '';
    // A patch thread locates its change alone, with no scout of its own route:
    // it carries both protocols.
    expect(patch).toContain('## Cross-cutting reading protocol 1');
    expect(patch).toContain('## Cross-cutting reading protocol 2');
    // Plan asks where a change SHOULD live — the purpose sweep's question.
    // The edges are the readers', delivered in their prompt, not here.
    expect(plan).toContain('## Cross-cutting reading protocol 1');
    expect(plan).not.toContain('## Cross-cutting reading protocol 2');
    // Read dispatches and assembles; the protocols live in the subagents it
    // dispatches to, so it carries neither.
    expect(read).not.toContain('## Cross-cutting reading protocol');
    expect(read).toContain('layered-spec-scout');
    expect(read).toContain('layered-slice-reader');
    // The brief thread has no `search_pages`: it gets the one line it can use.
    expect(brief).not.toContain('## Cross-cutting reading protocol');
    expect(brief).toContain('[Mm]odules/');
    expect(style.content).not.toContain('## Cross-cutting reading protocol');
    expect(style.files?.['workflows/apply.md']).not.toContain('## Cross-cutting reading protocol');
  });

  /**
   * The tool documents what `planPath` and `planMode` do; the workflow has to
   * say which one carries its decision. `payload` is an open record, so
   * `planMode` written inside it validates and the child silently runs
   * unrestricted — the one misplacement nothing downstream catches.
   */
  it('binds the delegation to the argument that carries it', () => {
    const apply = style.files?.['workflows/apply.md'] ?? '';
    const plan = style.files?.['workflows/plan.md'] ?? '';
    expect(apply).toContain('`payload.planPath`');
    expect(apply).toContain('`<current_plan>`');
    expect(plan).toContain('top-level `planMode: true`, not a `payload` key');
    expect(plan).toMatch(/give it no `planPath`/);
    for (const doc of [apply, plan]) {
      expect(doc).not.toMatch(/payload:\s*\{\s*planMode/);
    }
  });

  /**
   * A FILE LOADED AT MOST ONCE PER THREAD, A PART PASTED INTO AT MOST ONE OF THEM.
   *
   * A thread on an existing spec loads `read.md`, then `plan.md` and/or
   * `apply.md`, and every `tool_result` stays in the transcript. A part spliced
   * into two of the three would ride the same thread twice — the cost the split
   * exists to avoid. Checked on the sources, where the markers still name parts.
   */
  it('splices no part into two of read, plan and apply', () => {
    const sources = { 'read.md': readSource, 'plan.md': planSource, 'apply.md': applySource };
    const seen = new Map<string, string>();
    for (const [file, text] of Object.entries(sources)) {
      for (const [, name] of text.matchAll(/<!--\s*include:\s*(\S+)\s*-->/g)) {
        expect({ name, first: seen.get(name) ?? file, second: file }).toEqual({ name, first: file, second: file });
        seen.set(name!, file);
      }
    }
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
    // code span or fence is prose quoting the syntax (a workflow illustrating the
    // slice-schema form with `<tagged_list type="endpoint" .../>`); neither ships
    // an embed. Everything left is live.
    //
    // Order matters: fences and code spans come off FIRST. This package's prose
    // quotes comment syntax (`parts/placement.md` ships a backticked
    // `<!-- anchor: xxxxxxxx -->`), and an unbalanced `<!--` stripped as if it
    // opened a real comment would swallow the document down to the next `-->` —
    // in both templates, exactly the region holding the `ac` embeds. The test
    // would then pass on a file that ships one.
    const live = (text: string) =>
      text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`\n]*`/g, '')
        .replace(/<!--[\s\S]*?-->/g, '');
    const shipped: Array<[string, string]> = [
      ['SKILL.md', style.content],
      ...Object.entries(style.files ?? {}),
    ];
    for (const [where, text] of shipped) {
      const stripped = live(text);
      // A `<!--` surviving the strip is an unclosed comment: from here on the
      // assertion below would be reading a document the renderer reads
      // differently, so fail on the ambiguity rather than pass through it.
      expect({ where, unclosedComment: stripped.includes('<!--') }).toEqual({ where, unclosedComment: false });
      const embed = /<(?:tagged_list|element_list|inline_mention|single_element)\b[^>]*\btype="([^"]+)"/g;
      for (const [, type] of stripped.matchAll(embed)) {
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
      const start = text.indexOf('## Acceptance criteria');
      expect({ file, hasSection: start !== -1 }).toEqual({ file, hasSection: true });
      // Bounded at the next H2: unbounded, a `- [ ]` line in a LATER section
      // (`## Open questions` in the index template) would satisfy the check and
      // the test would stop proving anything about this section's live body.
      const after = text.slice(start + 1);
      const next = after.search(/^## /m);
      const section = next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
      // No variant comment is the legitimate case where the body IS the section.
      const comment = section.indexOf('<!--');
      const body = comment === -1 ? section : section.slice(0, comment);
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
