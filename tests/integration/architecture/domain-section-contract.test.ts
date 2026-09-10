import { beforeAll, describe, expect, it } from 'vitest';
import { SkillRegistry } from '../../../src/server/services/skill-registry.js';
import { validateWritingStyle } from '../../../src/server/core/plugin-host/manifest-adapter.js';
import { manifest } from '../../../plugins/c4s-plugin-layered-vertical-slices/src/manifest.js';

/**
 * 0.2.80 — the module's `## Domain` section becomes part of the content contract.
 *
 * The grid had no home for the substance of a module that NO LAYER OF THE PROJECT
 * ASKS ABOUT — its own model, its invariants, the lifecycle it owns end to end,
 * what it deliberately does not do. That content landed in `Cel`, in edge cases,
 * or in the "Domain" layer the package has always forbidden. This release gives
 * it a section, a membership test decided against the project's layer table, and
 * a catalogue of mechanically decidable rules.
 *
 * Read through the registry rather than off the path, for the reason
 * `cel-section-contract` states: the package has no path — it travels as `?raw`
 * literals compiled into its module, so the disk file is an input to the build and
 * not the thing `load_skill_file` serves.
 *
 * The one structural claim worth naming here: the rule block lives in ONE source
 * file (`parts/domain.md`) and is spliced into both workflows, which is what makes
 * the byte-equality below a property of the package rather than of an author's
 * diligence.
 */
describe('the layered-vertical-slices package carries the `Domain` section contract', () => {
  const SLUG = 'layered-vertical-slices';
  /** The H2 the rule block opens with, in both workflows. */
  const BLOCK = "## The module's `Domain` section";

  let core: string;
  let files: Record<string, string>;
  let moduleTemplate: string;

  /** The body of a `## `-level section, from its heading to the next H2 or EOF. */
  function h2(doc: string, heading: string): string {
    const start = doc.indexOf(`\n## ${heading}`);
    expect(start, `no "## ${heading}" section`).toBeGreaterThan(-1);
    const after = start + 1;
    const next = doc.indexOf('\n## ', after + 1);
    return doc.slice(after, next > -1 ? next : undefined);
  }

  /** Same, one level down: a `### ` block, bounded by the next heading of either level. */
  function h3(doc: string, heading: string): string {
    const start = doc.indexOf(`\n### ${heading}`);
    expect(start, `no "### ${heading}" section`).toBeGreaterThan(-1);
    const after = start + 1;
    const next = doc.slice(after + 1).search(/\n#{2,3} /);
    return next > -1 ? doc.slice(after, after + 1 + next) : doc.slice(after);
  }

  beforeAll(() => {
    const registry = SkillRegistry.load([]);
    for (const style of manifest.contributes.writingStyles ?? []) {
      registry.addPluginSkill(validateWritingStyle(style));
    }
    const resolved = registry.resolve(SLUG);
    core = resolved.content;
    files = Object.fromEntries(
      Object.entries(resolved.files ?? {}).map(([rel, f]) => [rel, f.content]),
    );
    moduleTemplate = files['templates/module.md'] ?? '';
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-9] states in the core that `Domain` is a module section, not a layer', () => {
    const concepts = h2(core, '2. Core concepts');
    expect(concepts).toMatch(/`Domain`|"Domain"/);
    expect(concepts).toMatch(/section\*{0,2},? not a layer/i);
    // The three things a layer has and this section does not. Named one by one,
    // because "not a layer" alone leaves an author free to give it a slice schema
    // "just for structure" and re-create the layer under another name.
    expect(concepts).toContain('layers/');
    expect(concepts).toContain('## Module slice schema');
    expect(concepts).toContain('Implementor module:');
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-16] states in the core that there is no `n/d` variant', () => {
    const concepts = h2(core, '2. Core concepts');
    expect(concepts).toContain('n/d');
    // The whole content of the rule: a module with nothing of its own DELETES the
    // section. A heading kept with a placeholder under it is the failure this
    // sentence exists to name.
    expect(concepts).toMatch(/omits it|omits the section/i);
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-10] makes `## Domain` the module template’s third H2, right after `## Zależności`', () => {
    const headings = [...moduleTemplate.matchAll(/^## .*$/gm)].map((m) => m[0]);
    expect(headings.slice(0, 3)).toEqual(['## Cel', '## Zależności', '## Domain']);
    // Literal, with no layer number and no suffix — `## Domain (L2)` is the
    // variant that turns the section back into the layer the package forbids.
    expect(moduleTemplate).not.toMatch(/^## Domain .+$/m);
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-11] puts the template’s `Domain` content exclusively under `###` headings', () => {
    const section = h2(moduleTemplate, 'Domain');
    const subs = [...section.matchAll(/^### .*$/gm)];
    expect(subs.length).toBeGreaterThanOrEqual(2);
    expect(section).not.toMatch(/^#### /m);
    // Everything before the first `###` is heading, blank line or the template's
    // own HTML comment: no prose stands directly under the H2.
    const preamble = section.slice(0, section.indexOf('\n### '));
    expect(preamble.replace(/<!--[\s\S]*?-->/g, '').replace(/^## Domain$/m, '').trim()).toBe('');
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-12] phrases the membership test against the project’s layer slice schemas, naming no layer of its own', () => {
    const block = h2(files['workflows/daily.md'] ?? '', BLOCK.slice(3));
    const residual = block.slice(
      block.indexOf('**What belongs here'),
      block.indexOf('### Rules decidable'),
    );
    expect(residual.length).toBeGreaterThan(200);
    expect(residual).toContain('## Module slice schema');
    // The test is a RESIDUUM against this project's layers, not a list of topics —
    // and it is time-varying, which is the half that gets dropped.
    expect(residual).toMatch(/no layer of this project asks about/i);
    expect(residual).toMatch(/relative/i);
    // Portable between projects: no layer identifier, no module identifier, and no
    // channel or entity type of any particular spec.
    expect(residual).not.toMatch(/\b[LM]\d+\b/);
    for (const token of ['HTTP', 'CLI', 'MCP', 'endpoint', 'DTO', 'ui-view', 'database table']) {
      expect({ token, named: residual.includes(token) }).toEqual({ token, named: false });
    }
    // The three questions, in order.
    const asks = residual.indexOf('Does any layer of this project ask for it?');
    const owns = residual.indexOf('Does this module own the fact?');
    const kind = residual.indexOf('Specification or implementation?');
    expect(asks).toBeGreaterThan(-1);
    expect(asks).toBeLessThan(owns);
    expect(owns).toBeLessThan(kind);
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-13] catalogues the mechanically decidable `Domain` rules, each with a named violation symptom', () => {
    const catalogue = h3(files['workflows/daily.md'] ?? '', 'Rules decidable on the `Domain` section text alone');
    const items = [...catalogue.matchAll(/^\d+\. \*\*(.+?)\*\*/gm)];
    expect(items.length).toBe(6);
    const symptoms = [...catalogue.matchAll(/\*Symptom:\*/g)];
    expect(symptoms.length).toBe(items.length);
    // The budgets are the two numbers the catalogue cannot state as "keep it
    // short" — they are what makes item 6 decidable at all.
    expect(catalogue).toMatch(/\b3500\b/);
    expect(catalogue).toMatch(/\b12000\b/);
    // And the seventh position, which is deliberately NOT in the six: it is
    // settled against the layer table, with the negative test that catches the
    // usual failure.
    const block = h2(files['workflows/daily.md'] ?? '', BLOCK.slice(3));
    expect(block).toMatch(/settled against the layer table/i);
    expect(block).toMatch(/another module's verbs/);
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-14] enumerates `Dom 1`–`Dom 6` in the daily drift check, one per mechanical rule', () => {
    const step = h2(files['workflows/daily.md'] ?? '', 'Step 5 — Drift check');
    const listed = [...step.matchAll(/^- \*\*Dom (\d+) — (.+?)\.\*\* (.+)$/gm)];
    expect(listed.map((m) => m[1])).toEqual(['1', '2', '3', '4', '5', '6']);
    // Each carries its symptom — the drift check is walked by a reader who does
    // not already know the rules, so a bare rule name checks nothing.
    for (const [, n, , symptom] of listed) {
      expect({ n, symptom: symptom.trim().length > 0 }).toEqual({ n, symptom: true });
    }
    // Not collapsed into one "check Domain" bullet, which is what the projection
    // would degrade to if the rules stopped being numbered items with markers.
    expect(listed.length).toBe(6);
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-15] delivers the very same `Domain` block to bootstrap as to daily', () => {
    const daily = files['workflows/daily.md'] ?? '';
    const bootstrap = files['workflows/bootstrap.md'] ?? '';
    for (const [name, doc] of [['daily', daily], ['bootstrap', bootstrap]] as const) {
      expect({ name, present: doc.includes(BLOCK) }).toEqual({ name, present: true });
    }
    // Byte equality, not "both mention Domain": the block has ONE home in source
    // and is spliced into both, so a rule reworded for one reader is reworded for
    // the other.
    expect(h2(bootstrap, BLOCK.slice(3)).trim()).toBe(h2(daily, BLOCK.slice(3)).trim());

    // Bootstrap still refuses a layer called `Domain` — and now says where that
    // content goes instead.
    const phase2 = h2(bootstrap, 'Phase 2 — Layer proposal');
    expect(phase2).toMatch(/Do not propose `L2 Domain`/);
    expect(phase2).toContain('`## Domain`');
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-17] names the moment a layer is born from repeated `Domain` content', () => {
    const block = h2(files['workflows/daily.md'] ?? '', BLOCK.slice(3));
    expect(block).toMatch(/several modules/i);
    expect(block).toMatch(/same shape|same kind/i);
    // The consequence is a PROPOSAL with a slice schema, not a nudge to write less
    // prose — the budgets are the detector, and the block says so.
    expect(block).toContain('## Module slice schema');
    expect(block).toMatch(/detector, not prose hygiene/i);
    expect(block).toMatch(/not to shorten prose/i);
  });

  /**
   * The brief workflow's recognition table decides what reaches an implementer in
   * another repository. `Domain` is the module's own substance, so a diff in it is
   * feature substance — classified with `Cel`, not dropped as spec-format the way a
   * layer file's slice schema is.
   */
  it('classifies a `Domain` diff as substantive in the brief recognition table', () => {
    const brief = files['workflows/brief.md'] ?? '';
    const row = brief.split('\n').find((l) => l.startsWith('| Diff inside `modules/MXX-*.md` § `Domain`'));
    expect(row, 'no recognition-table row for a `Domain` diff').toBeDefined();
    expect(row).toContain('substantive');
    expect(row).toMatch(/Translate/);
  });
});
