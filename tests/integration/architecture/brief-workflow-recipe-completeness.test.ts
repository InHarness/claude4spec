import { beforeAll, describe, expect, it } from 'vitest';
import { SkillRegistry } from '../../../src/server/services/skill-registry.js';
import { validateWritingStyle } from '../../../src/server/core/plugin-host/manifest-adapter.js';
import { manifest } from '../../../plugins/c4s-plugin-layered-vertical-slices/src/manifest.js';

/**
 * 2.1.14 — completeness of a workflow brief's recipes.
 *
 * The implementation loop builds and verifies only what a unit's recipe names:
 * a criterion left off every recipe gets no test, an entity left off gets no
 * shape check, and nothing reports it before the whole window is verified. The
 * map used to pick criteria by changed module sections and by `verifies` aimed
 * at a changed entity — which loses exactly what the window changed without
 * touching a module section. So `workflows/brief-workflow.md` now takes the list
 * from the window, assigns a slug without a module, and checks the result.
 *
 * Read through the registry — what `load_skill_file('layered-vertical-slices',
 * 'workflows/brief-workflow.md')` serves — not off the path: the package travels
 * as `?raw` literals compiled into its module (see `cel-section-contract`).
 */
describe('workflows/brief-workflow.md keeps every slug of the window in the recipes', () => {
  const SLUG = 'layered-vertical-slices';
  let workflow: string;

  /**
   * A step, from its `## Step N` heading to the next `## Step` heading or EOF.
   * Bounded by steps, not by any H2: Step 1 splices in `parts/brief-substance.md`,
   * whose own H2s would otherwise cut the step short.
   */
  function h2(doc: string, prefix: string): string {
    const start = doc.indexOf(`\n## ${prefix}`);
    expect(start, `no "## ${prefix}" section`).toBeGreaterThan(-1);
    const next = doc.indexOf('\n## Step ', start + 1);
    return doc.slice(start + 1, next > -1 ? next : undefined);
  }

  beforeAll(() => {
    const registry = SkillRegistry.load([]);
    for (const style of manifest.contributes.writingStyles ?? []) {
      registry.addPluginSkill(validateWritingStyle(style));
    }
    const resolved = registry.resolve(SLUG);
    workflow = resolved.files?.['workflows/brief-workflow.md']?.content ?? '';
    expect(workflow.length).toBeGreaterThan(100);
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-18] the map step pulls in every active criterion and every entity the window created or changed, whether or not a changed section points at it', () => {
    const map = h2(workflow, 'Step 1 — The map');
    // every active `ac` criterion and every entity, created or changed, straight from the window
    expect(map).toMatch(/every active `ac` criterion and every entity[^.]*with `op` create or update in the window is on the map/);
    expect(map).toContain('straight from the window');
    // independent of a changed section pointing at it (and of `verifies` aimed at a changed entity)
    expect(map).toMatch(/not only those a section changed in the window points at, or whose `verifies` targets an entity the window changed/);
    // sections and `verifies` decide the unit, never whether the slug enters
    expect(map).toMatch(/decide only \*\*which unit\*\* a slug goes to, never \*\*whether\*\* it enters the recipes/);
    // the old narrowing — return only the slugs whose `verifies` matches — is gone
    expect(workflow).not.toContain('asked to return only the matching slugs');
  });

  it('[ac:ac-load-skill-file-layered-vertical-slic-19] the final checklist requires every criterion and entity slug created or changed in the window to stand in the Read: line of exactly one unit', () => {
    const checklist = h2(workflow, 'Step 5 — Checklist');
    const item = checklist.split('\n').find((line) => line.startsWith('- [ ]') && line.includes('created or changed'));
    expect(item, 'no checklist item about the window\'s slugs').toBeDefined();
    expect(item).toMatch(/Every criterion and entity slug the window created or changed stands in the `Read:` line of exactly one unit/);
    // a part-wise build keeps one owner per part
    expect(item).toContain('`not yet` / `completes`');
  });

  it('[ac:ac-gdy-kryterium-albo-encji-z-okna-nie-p] a slug that neither tags nor `verifies` assign goes to the unit reading its subject, else to the last wave', () => {
    const units = h2(workflow, 'Step 2 — Design the units');
    const rule = units.split('\n').find((line) => line.includes('**A slug without a module still has a unit.**'));
    expect(rule, 'no assignment rule for a slug without a module').toBeDefined();
    // neither module tags nor `verifies` assign it
    expect(rule).toMatch(/neither module tags nor `verifies` assign/);
    // → the unit whose recipe reads the section or entity it is about
    expect(rule).toMatch(/goes to the unit whose recipe reads the section or the entity it is about/);
    // → otherwise a unit of the last wave, never dropped
    expect(rule).toMatch(/when no unit reads it, to a unit of the last wave/);
    expect(rule).toMatch(/never drops out of the recipes/);
    // the map keeps such a slug for Step 2 instead of dropping it
    expect(h2(workflow, 'Step 1 — The map')).toMatch(/neither its tags nor its `verifies` assign to a module still stays on the map/);
    // and the checklist re-checks the same routing
    expect(h2(workflow, 'Step 5 — Checklist')).toMatch(/sits in the unit whose recipe reads the section or entity it is about, or else in a unit of the last wave/);
  });
});
