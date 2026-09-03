import { beforeAll, describe, expect, it } from 'vitest';
import { SkillRegistry } from '../../../src/server/services/skill-registry.js';
import { manifest } from '../../../plugins/c4s-plugin-writing-style-author/src/manifest.js';

/**
 * 0.2.65 — the scaffold seeds the form clause, so a new style is not born blind.
 *
 * `writing-style-author` is the only thing in the system that CREATES writing-style
 * packages. Fixing the form clause in the reference style alone cures one specimen
 * and leaves the factory: every style scaffolded from an instruction that never
 * mentions entities inherits exactly the blindness the reference style was just
 * repaired of, however many types the project has active.
 *
 * What this file can assert is the INSTRUCTION, not its result. The acceptance
 * criterion behind the change (`ac-skill-md-wygenerowany-przez-scaffold`) is about
 * the `SKILL.md` a scaffold RUN produces, which needs a live agent turn and is
 * skiplisted for that reason — reading the scaffold's own file does not close it.
 * This is the cheaper guard beneath it: the clause cannot silently fall out of the
 * instruction between one release and the next.
 *
 * Read through the registry rather than off the path — what the host serves is the
 * registry ENTRY, and since 0.2.66 the scaffold has no path at all: it left the
 * retired in-package root for the `c4s-plugin-writing-style-author` envelope and now
 * travels as literals compiled into that module. Pushing the manifest's own
 * contribution through `addPluginSkill` is therefore both the shortest route to the
 * served content and a check that the envelope really carries it.
 */
describe('the writing-style scaffold carries the form clause it must emit', () => {
  const SCAFFOLD = 'writing-style-author';

  let content: string;
  let clause: string;

  /** The block the scaffold emits verbatim, bounded by its fence — not the rest
   *  of the instruction around it, which is free to name types illustratively. */
  function formClause(skill: string): string {
    const start = skill.indexOf('**Form clause.**');
    expect(start, 'the scaffold does not carry a form clause at all').toBeGreaterThan(-1);
    const end = skill.indexOf('```', start);
    return skill.slice(start, end > -1 ? end : undefined);
  }

  beforeAll(() => {
    const registry = SkillRegistry.load([]);
    for (const skill of manifest.contributes.skills ?? []) registry.addPluginSkill(skill);
    content = registry.resolve(SCAFFOLD).content;
    clause = formClause(content);
  });

  it('emits the clause with the entity form listed before the fenced one', () => {
    expect(content).toContain('**Form clause.**');

    const entity = clause.indexOf('an embed of project entities');
    const fence = clause.indexOf('a fenced block');
    expect(entity).toBeGreaterThan(-1);
    expect(fence).toBeGreaterThan(-1);
    // Equality of standing is an ordering claim: the first form listed reads as the
    // default, so an entity mentioned after the fence is a footnote, not an equal.
    expect(entity).toBeLessThan(fence);
    // …and the clause has to say why, or the next editor will reorder it back.
    expect(clause).toMatch(/first form listed reads as the default/);
  });

  it('writes the clause over the type variable, with no concrete slug hardcoded', () => {
    // A slug here would cost every scaffolded style its portability between projects
    // with different `config.entities` catalogues — the clause is conditional on the
    // project modelling the thing as an entity type, whatever that type is called.
    expect(clause).toMatch(/when the project models this kind\s*\n?\s*of thing as an entity type/);
    for (const slug of ['code-snippet', 'endpoint', 'database-table', 'ui-view', 'dto']) {
      expect({ slug, present: clause.includes(slug) }).toEqual({ slug, present: false });
    }
  });

  it('makes the generated style state the scope of any prohibition it carries', () => {
    // The second half of the M15 obligation, and the half that is easy to drop: a
    // blanket "no X" in a style APPEARS to contradict an active type whose promotion
    // threshold admits the very content it seems to forbid.
    expect(clause).toMatch(/must state its scope/);
    expect(clause).toMatch(/what the prohibition does not cover/);
  });
});
